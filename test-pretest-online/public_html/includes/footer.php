<?php
$layout = $layout ?? 'user';
$extraScripts = $extraScripts ?? [];
?>
<?php if ($layout === 'admin' && current_user()): ?>
        </div>
        <footer class="app-footer">© <?= date('Y') ?> <?= e(APP_NAME) ?> · <?= e(APP_TAGLINE) ?></footer>
    </main>
</div>
<?php elseif ($layout === 'user' && current_user()): ?>
</main>
<footer class="app-footer text-center">© <?= date('Y') ?> <?= e(APP_NAME) ?> · <?= e(APP_TAGLINE) ?></footer>
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
