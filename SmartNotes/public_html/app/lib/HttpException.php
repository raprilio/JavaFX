<?php
declare(strict_types=1);

defined('SN_APP') || exit;

final class HttpException extends RuntimeException
{
    public function __construct(string $message, int $code = 400, public array $errors = [])
    {
        parent::__construct($message, $code);
    }
}
