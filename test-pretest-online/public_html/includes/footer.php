<?php
$layout = $layout ?? 'user';
$extraScripts = $extraScripts ?? [];
$footerText = setting('footer_text') ?: (setting('institution_name') . ' ' . setting('institution_region'));
?>
<?php if ($layout === 'admin' && current_user()): ?>
        </div>
        <footer class="app-footer">© <?= date('Y') ?> <?= e(app_name()) ?> · <?= e($footerText) ?></footer>
    </main>
</div>
<?php elseif ($layout === 'user' && current_user()): ?>
</main>
<footer class="app-footer text-center">© <?= date('Y') ?> <?= e(app_name()) ?> · <?= e($footerText) ?></footer>
<?php else: ?>
</main>
<?php endif; ?>

<script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js"></script>
<script src="<?= e(asset('js/app.js')) ?>"></script>
<?php foreach ($extraScripts as $src): ?>
<script src="<?= e(preg_match('#^https?://#', $src) ? $src : asset($src)) ?>"></script>
<?php endforeach; ?>
</body>
</html>
