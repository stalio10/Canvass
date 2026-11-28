<?php
/* Lead Finder · load every module. */
declare(strict_types=1);
require_once __DIR__ . '/../core.php';
foreach (['util', 'config', 'places', 'verify', 'website_audit', 'gbp_audit', 'scoring', 'pitch', 'store', 'engine', 'reports', 'assign', 'demo'] as $f) require_once __DIR__ . "/$f.php";
