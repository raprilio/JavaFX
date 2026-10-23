// MP4 muxing helpers for the video export (v1.28.1), kept free of DOM code so they can be tested on their own.
// Some encoders (Firefox) send no decoderConfig and write H.264 as Annex-B (start codes) — the MP4 then has no
// avcC/vpcC box and the muxer fails ("t.info.decoderConfig is null"). We rebuild what is missing (v1.28.1).
const BT709 = { primaries: 'bt709', transfer: 'bt709', matrix: 'bt709', fullRange: false };

/** Split H.264 into NAL units: Annex-B (00 00 01 / 00 00 00 01) or 4-byte length prefixed. */
export function nalUnits(u8) {
  const annexB = u8.length > 3 && u8[0] === 0 && u8[1] === 0 && (u8[2] === 1 || (u8[2] === 0 && u8[3] === 1));
  const out = [];
  if (!annexB) {
    for (let i = 0; i + 4 <= u8.length;) {
      const n = (u8[i] << 24 | u8[i + 1] << 16 | u8[i + 2] << 8 | u8[i + 3]) >>> 0;
      if (!n || i + 4 + n > u8.length) return { annexB, nals: [] };
      out.push(u8.subarray(i + 4, i + 4 + n));
      i += 4 + n;
    }
    return { annexB, nals: out };
  }
  let start = -1;
  for (let i = 0; i + 2 < u8.length; i++) {
    if (u8[i] === 0 && u8[i + 1] === 0 && u8[i + 2] === 1) {
      if (start >= 0) out.push(u8.subarray(start, i > 0 && u8[i - 1] === 0 ? i - 1 : i));
      start = i + 3;
      i += 2;
    }
  }
  if (start >= 0) out.push(u8.subarray(start));
  return { annexB, nals: out.filter((n) => n.length) };
}

/** chroma format and bit depths from an SPS (needed in avcC for the High profiles). */
function spsInfo(sps) {
  const b = [];
  for (let i = 1; i < sps.length; i++) { if (i > 2 && sps[i] === 3 && sps[i - 1] === 0 && sps[i - 2] === 0) continue; b.push(sps[i]); } // drop emulation prevention
  let pos = 24; // after profile_idc, constraint flags, level_idc
  const bit = () => (b[pos >> 3] >> (7 - (pos++ & 7))) & 1;
  const ue = () => { let z = 0; while (pos < b.length * 8 && !bit()) z++; let v = 1; for (let k = 0; k < z; k++) v = (v << 1) | bit(); return v - 1; };
  ue(); // seq_parameter_set_id
  const info = { chroma: 1, depthLuma: 0, depthChroma: 0 };
  if ([100, 110, 122, 244, 44, 83, 86, 118, 128, 138, 139, 134, 135].includes(b[0])) {
    info.chroma = ue();
    if (info.chroma === 3) bit();
    info.depthLuma = ue();
    info.depthChroma = ue();
  }
  return info;
}

/** AVCDecoderConfigurationRecord (the avcC box payload) from one SPS and one PPS. */
export function avcConfig(sps, pps) {
  const out = [1, sps[1], sps[2], sps[3], 0xff, 0xe1, sps.length >> 8, sps.length & 255, ...sps, 1, pps.length >> 8, pps.length & 255, ...pps];
  if ([100, 110, 122, 144].includes(sps[1])) {
    const i = spsInfo(sps);
    out.push(0xfc | (i.chroma & 3), 0xf8 | (i.depthLuma & 7), 0xf8 | (i.depthChroma & 7), 0);
  }
  return new Uint8Array(out);
}

/**
 * Feed encoder output into the muxer; when the encoder gave no decoderConfig, build it (H.264 from the SPS/PPS of the
 * first key frame, VP9 / AV1 from the codec string) and turn Annex-B samples into length-prefixed ones.
 */
export function muxFeeder(muxer, codec) {
  let mode = null; // 'native': the encoder's own decoderConfig is usable; 'built': we make it
  let built = false;
  return (chunk, meta) => {
    if (!mode) {
      const dc = meta?.decoderConfig;
      mode = dc && (codec.muxCodec !== 'avc' || dc.description) ? 'native' : 'built';
    }
    if (mode === 'native') {
      const dc = meta?.decoderConfig;
      if (dc && codec.muxCodec === 'vp9' && !dc.colorSpace) meta = { ...meta, decoderConfig: { ...dc, colorSpace: BT709 } };
      return muxer.addVideoChunk(chunk, meta);
    }
    const data = new Uint8Array(chunk.byteLength);
    chunk.copyTo(data);
    const base = { codec: codec.cfg.codec, codedWidth: codec.cfg.width, codedHeight: codec.cfg.height };
    if (codec.muxCodec !== 'avc') {
      const first = built ? undefined : { decoderConfig: { ...base, colorSpace: BT709 } };
      built = true;
      return muxer.addVideoChunkRaw(data, chunk.type, chunk.timestamp, chunk.duration ?? 0, first);
    }
    const { nals } = nalUnits(data);
    let first;
    if (!built) {
      const sps = nals.find((n) => (n[0] & 31) === 7), pps = nals.find((n) => (n[0] & 31) === 8);
      if (!sps || !pps) throw new Error('The video encoder gave no stream description (SPS/PPS). Try Chrome or Edge.');
      first = { decoderConfig: { ...base, description: avcConfig(sps, pps) } };
      built = true;
    }
    // length-prefixed samples without parameter sets / access unit delimiters (they live in avcC)
    const keep = nals.filter((n) => ![7, 8, 9].includes(n[0] & 31));
    const out = new Uint8Array(keep.reduce((a, n) => a + 4 + n.length, 0));
    let o = 0;
    keep.forEach((n) => { new DataView(out.buffer).setUint32(o, n.length); out.set(n, o + 4); o += 4 + n.length; });
    return muxer.addVideoChunkRaw(out, chunk.type, chunk.timestamp, chunk.duration ?? 0, first);
  };
}
