-- =====================================================================
--  Data contoh (opsional). Import SETELAH schema.sql.
--  Akun peserta demo: raka / andi / sinta  — password: User@123
-- =====================================================================
SET NAMES utf8mb4;

INSERT INTO users (id, name, username, email, password, role, department, position, status) VALUES
(2, 'Raka Aprilio', 'raka',  'raka@example.com',  '$2y$10$CZ4t2UNNXTSJQ701XAd.nuMEf4mhL8lHNuk5gUMA41OxlYjzaQ1h2', 'user', 'IT',      'IT Support',       'active'),
(3, 'Andi Saputra', 'andi',  'andi@example.com',  '$2y$10$CZ4t2UNNXTSJQ701XAd.nuMEf4mhL8lHNuk5gUMA41OxlYjzaQ1h2', 'user', 'IT',      'Network Engineer', 'active'),
(4, 'Sinta Maharani','sinta','sinta@example.com', '$2y$10$CZ4t2UNNXTSJQ701XAd.nuMEf4mhL8lHNuk5gUMA41OxlYjzaQ1h2', 'user', 'Finance', 'Staff',            'active');

INSERT INTO categories (id, name, description) VALUES
(1, 'IT Support', 'Dasar perangkat keras & sistem operasi'),
(2, 'Networking', 'Jaringan komputer'),
(3, 'Keamanan',   'Keamanan informasi');

INSERT INTO questions (id, category_id, question, question_type, difficulty, points, explanation, created_by) VALUES
(1, 2, 'Perangkat yang berfungsi menghubungkan dua atau lebih jaringan yang berbeda adalah...', 'multiple_choice', 'easy', 2, 'Router bekerja di layer Network dan meneruskan paket antar jaringan berbeda.', 1),
(2, 2, 'Port default yang digunakan oleh protokol HTTPS adalah...', 'multiple_choice', 'easy', 2, 'HTTPS menggunakan port 443, sedangkan HTTP menggunakan port 80.', 1),
(3, 1, 'Perintah di Windows untuk menampilkan konfigurasi alamat IP adalah...', 'multiple_choice', 'easy', 2, 'ipconfig menampilkan IP address, subnet mask, dan default gateway.', 1),
(4, 1, 'RAM merupakan singkatan dari...', 'multiple_choice', 'easy', 2, NULL, 1),
(5, 2, 'Alamat IP 192.168.1.10 termasuk ke dalam kelas...', 'multiple_choice', 'medium', 2, 'Rentang kelas C adalah 192.0.0.0 – 223.255.255.255.', 1),
(6, 2, 'Layer pada model OSI yang bertanggung jawab atas routing adalah...', 'multiple_choice', 'medium', 2, 'Layer 3 (Network) menangani pengalamatan logis dan routing.', 1),
(7, 1, 'Tool yang paling tepat untuk menguji konektivitas ke host lain adalah...', 'multiple_choice', 'easy', 2, NULL, 1),
(8, 3, 'Teknik serangan yang menipu korban melalui email palsu agar memberikan data sensitif disebut...', 'multiple_choice', 'medium', 2, 'Phishing memanfaatkan rekayasa sosial melalui email/situs palsu.', 1),
(9, 1, 'Manakah yang termasuk perangkat input? (pilih semua yang benar)', 'multiple_answer', 'medium', 3, 'Monitor adalah perangkat output.', 1),
(10, 3, 'Manakah yang termasuk prinsip CIA Triad? (pilih semua yang benar)', 'multiple_answer', 'hard', 3, 'CIA = Confidentiality, Integrity, Availability.', 1),
(11, 2, 'DHCP memberikan alamat IP secara otomatis kepada client.', 'true_false', 'easy', 1, NULL, 1),
(12, 1, 'SSD memiliki kecepatan baca/tulis lebih lambat dibandingkan HDD.', 'true_false', 'easy', 1, 'SSD jauh lebih cepat karena tidak memiliki komponen mekanis.', 1),
(13, 2, 'Kepanjangan dari DNS adalah...', 'short_answer', 'medium', 2, 'DNS = Domain Name System, menerjemahkan nama domain ke alamat IP.', 1),
(14, 1, 'Perintah Linux untuk menampilkan daftar isi direktori adalah...', 'short_answer', 'easy', 2, NULL, 1),
(15, 1, 'Jelaskan langkah-langkah troubleshooting ketika seorang user melaporkan tidak dapat terhubung ke internet.', 'essay', 'hard', 5, 'Cek fisik/kabel/Wi-Fi, IP (ipconfig), ping gateway, ping DNS publik, cek DNS, cek proxy/firewall, eskalasi.', 1);

INSERT INTO question_options (question_id, option_text, is_correct, sort_order) VALUES
(1, 'Switch', 0, 0), (1, 'Router', 1, 1), (1, 'Hub', 0, 2), (1, 'Repeater', 0, 3),
(2, '21', 0, 0), (2, '80', 0, 1), (2, '443', 1, 2), (2, '3389', 0, 3),
(3, 'ipconfig', 1, 0), (3, 'ping', 0, 1), (3, 'tracert', 0, 2), (3, 'netstat', 0, 3),
(4, 'Random Access Memory', 1, 0), (4, 'Read Access Memory', 0, 1), (4, 'Rapid Access Module', 0, 2), (4, 'Random Allocation Memory', 0, 3),
(5, 'Kelas A', 0, 0), (5, 'Kelas B', 0, 1), (5, 'Kelas C', 1, 2), (5, 'Kelas D', 0, 3),
(6, 'Physical', 0, 0), (6, 'Data Link', 0, 1), (6, 'Network', 1, 2), (6, 'Transport', 0, 3),
(7, 'ping', 1, 0), (7, 'chkdsk', 0, 1), (7, 'sfc', 0, 2), (7, 'regedit', 0, 3),
(8, 'Phishing', 1, 0), (8, 'DDoS', 0, 1), (8, 'Brute force', 0, 2), (8, 'SQL Injection', 0, 3),
(9, 'Keyboard', 1, 0), (9, 'Mouse', 1, 1), (9, 'Monitor', 0, 2), (9, 'Scanner', 1, 3),
(10, 'Confidentiality', 1, 0), (10, 'Integrity', 1, 1), (10, 'Availability', 1, 2), (10, 'Authentication', 0, 3),
(11, 'Benar', 1, 0), (11, 'Salah', 0, 1),
(12, 'Benar', 0, 0), (12, 'Salah', 1, 1),
(13, 'Domain Name System', 1, 0), (13, 'Domain Name Service', 1, 1),
(14, 'ls', 1, 0), (14, 'ls -l', 1, 1);

INSERT INTO exams (id, title, description, instructions, type, duration, passing_grade, show_result, show_correct_answer,
                   random_question, random_answer, question_count, max_attempts, status, created_by) VALUES
(1, 'Pre-Test IT Support', 'Mengukur kemampuan awal peserta sebelum pelatihan IT Support.',
 'Kerjakan seluruh soal dengan jujur.\nPre-Test ini untuk mengetahui kemampuan awal Anda.\nScore akan langsung ditampilkan setelah submit.',
 'pretest', 30, 70, 1, 1, 0, 0, 0, 3, 'published', 1),
(2, 'Test IT Support', 'Ujian resmi sertifikasi internal IT Support.',
 'Ini adalah TEST RESMI.\nSoal dan pilihan jawaban diacak untuk setiap peserta.\nHasil tidak ditampilkan setelah submit dan akan diproses oleh administrator.',
 'test', 45, 75, 0, 0, 1, 1, 12, 1, 'published', 1);

INSERT INTO exam_questions (exam_id, question_id, question_order) VALUES
(1, 1, 1), (1, 2, 2), (1, 3, 3), (1, 4, 4), (1, 5, 5), (1, 6, 6), (1, 7, 7),
(1, 9, 8), (1, 11, 9), (1, 12, 10), (1, 13, 11), (1, 14, 12),
(2, 1, 1), (2, 2, 2), (2, 3, 3), (2, 4, 4), (2, 5, 5), (2, 6, 6), (2, 7, 7), (2, 8, 8),
(2, 9, 9), (2, 10, 10), (2, 11, 11), (2, 12, 12), (2, 13, 13), (2, 14, 14), (2, 15, 15);
