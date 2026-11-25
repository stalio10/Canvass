<?php
/* Local test server only (php -S): does what .htaccess does on Hostinger — keeps the code library and data private. */
$path = rawurldecode(parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/');
if (preg_match('#^/(lib|data|tests)(/|$)|\.(sqlite|db|bak|md|ini)$|^/router\.php#i', $path)) { http_response_code(403); echo 'Forbidden'; return true; }
if ($path === '/cron.php' || $path === '/config.php') { http_response_code(403); echo 'Forbidden'; return true; }
return false;   // let the built-in server handle everything else
