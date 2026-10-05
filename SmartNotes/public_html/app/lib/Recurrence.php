<?php
declare(strict_types=1);

defined('SN_APP') || exit;

/**
 * Expands repeating calendar events (daily / weekly / monthly / yearly).
 */
final class Recurrence
{
    /** Start timestamp of the k-th occurrence (k = 0 is the original). */
    public static function at(int $base, string $rule, int $k): int
    {
        if ($k === 0 || $rule === 'none') {
            return $base;
        }
        [$y, $m, $d, $H, $i, $s] = array_map('intval', explode(' ', date('Y n j G i s', $base)));
        switch ($rule) {
            case 'daily':
                return mktime($H, $i, $s, $m, $d + $k, $y);
            case 'weekly':
                return mktime($H, $i, $s, $m, $d + 7 * $k, $y);
            case 'monthly':
            case 'yearly':
                $months = $rule === 'monthly' ? $k : 12 * $k;
                $ty = $y + intdiv($m - 1 + $months, 12);
                $tm = (($m - 1 + $months) % 12) + 1;
                $dim = (int) date('t', mktime(0, 0, 0, $tm, 1, $ty));
                return mktime($H, $i, $s, $tm, min($d, $dim), $ty);
        }
        return $base;
    }

    /** A safe lower-bound index for occurrences near $ts. */
    private static function startIndex(int $base, string $rule, int $ts): int
    {
        if ($ts <= $base) {
            return 0;
        }
        $days = (int) floor(($ts - $base) / 86400);
        return max(0, match ($rule) {
            'daily' => $days - 1,
            'weekly' => intdiv($days, 7) - 1,
            'monthly' => intdiv($days, 31) - 1,
            'yearly' => intdiv($days, 366) - 1,
            default => 0,
        });
    }

    /**
     * Occurrences overlapping [$rangeStart, $rangeEnd].
     * @return array<int, array{0:int,1:int}> list of [startTs, endTs]
     */
    public static function between(string $startAt, string $endAt, string $rule, ?string $until, int $rangeStart, int $rangeEnd, int $max = 400): array
    {
        $base = strtotime($startAt);
        $dur = max(0, strtotime($endAt) - $base);
        if ($rule === 'none' || $rule === '') {
            return ($base <= $rangeEnd && $base + $dur >= $rangeStart) ? [[$base, $base + $dur]] : [];
        }
        $untilTs = $until ? strtotime($until . ' 23:59:59') : PHP_INT_MAX;
        $out = [];
        $k = self::startIndex($base, $rule, $rangeStart - $dur);
        for ($n = 0; $n < $max + 60; $n++, $k++) {
            $s = self::at($base, $rule, $k);
            if ($s > $rangeEnd || $s > $untilTs) {
                break;
            }
            if ($s + $dur >= $rangeStart) {
                $out[] = [$s, $s + $dur];
                if (count($out) >= $max) {
                    break;
                }
            }
        }
        return $out;
    }

    /** First occurrence starting at or after $after; null if the series has ended. */
    public static function next(string $startAt, string $rule, ?string $until, int $after): ?int
    {
        $base = strtotime($startAt);
        if ($rule === 'none' || $rule === '') {
            return $base >= $after ? $base : null;
        }
        $untilTs = $until ? strtotime($until . ' 23:59:59') : PHP_INT_MAX;
        $k = self::startIndex($base, $rule, $after);
        for ($n = 0; $n < 1000; $n++, $k++) {
            $s = self::at($base, $rule, $k);
            if ($s > $untilTs) {
                return null;
            }
            if ($s >= $after) {
                return $s;
            }
        }
        return null;
    }
}
