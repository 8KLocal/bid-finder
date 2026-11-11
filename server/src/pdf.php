<?php
declare(strict_types=1);

function pdf_inspect(string $path, int $maxBytes = 10485760): int
{
    $size = filesize($path);
    if ($size === false || $size < 5 || $size > $maxBytes) {
        throw new InvalidArgumentException('PDF must be under 10 MB.');
    }
    $fh = fopen($path, 'rb');
    $magic = $fh ? fread($fh, 5) : '';
    if ($fh) {
        fclose($fh);
    }
    if ($magic !== '%PDF-') {
        throw new InvalidArgumentException('Upload a PDF file.');
    }
    $raw = file_get_contents($path);
    if ($raw === false) {
        throw new InvalidArgumentException('Could not read the PDF.');
    }
    if (preg_match('/\/Encrypt\b/', $raw)) {
        throw new InvalidArgumentException('Remove the PDF password before uploading.');
    }
    preg_match_all('/\/Type\s*\/Page(?!s)/', $raw, $m);
    $pages = count($m[0]);
    if ($pages < 1) {
        throw new InvalidArgumentException('The PDF has no pages we could count.');
    }
    if ($pages > 60) {
        throw new InvalidArgumentException('PDFs are limited to 60 pages.');
    }
    return $pages;
}

function pdf_from_text(string $text, string $dest): int
{
    $lines = explode("\n", str_replace(["\r\n", "\r"], "\n", $text));
    $wrapped = [];
    foreach ($lines as $line) {
        $line = str_replace(["\\", "(", ")"], ["\\\\", "\\(", "\\)"], $line);
        if (strlen($line) <= 90) {
            $wrapped[] = $line;
            continue;
        }
        foreach (str_split($line, 90) as $chunk) {
            $wrapped[] = $chunk;
        }
    }
    $pages = array_chunk($wrapped, 46);
    if (!$pages) {
        $pages = [['']];
    }
    $objects = [];
    $objects[] = "<< /Type /Catalog /Pages 2 0 R >>";
    $kids = [];
    $pageObjects = [];
    $contentIds = [];
    $next = 3;
    foreach ($pages as $i => $pageLines) {
        $kids[] = ($next) . " 0 R";
        $contentIds[] = $next + 1;
        $next += 2;
    }
    $objects[] = "<< /Type /Pages /Count " . count($pages) . " /Kids [" . implode(' ', $kids) . "] >>";
    $fontId = $next;
    foreach ($pages as $i => $pageLines) {
        $contentId = $contentIds[$i];
        $objects[] = "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents {$contentId} 0 R /Resources << /Font << /F1 {$fontId} 0 R >> >> >>";
        $stream = "BT /F1 11 Tf 54 740 Td 14 TL\n";
        foreach ($pageLines as $n => $line) {
            $stream .= "(" . $line . ") Tj\nT*\n";
        }
        $stream .= "ET";
        $objects[] = "<< /Length " . strlen($stream) . " >>\nstream\n" . $stream . "\nendstream";
    }
    $objects[] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
    $pdf = "%PDF-1.4\n";
    $offsets = [0];
    foreach ($objects as $i => $object) {
        $offsets[] = strlen($pdf);
        $pdf .= ($i + 1) . " 0 obj\n" . $object . "\nendobj\n";
    }
    $xref = strlen($pdf);
    $pdf .= "xref\n0 " . (count($objects) + 1) . "\n";
    $pdf .= "0000000000 65535 f \n";
    for ($i = 1; $i <= count($objects); $i++) {
        $pdf .= sprintf("%010d 00000 n \n", $offsets[$i]);
    }
    $pdf .= "trailer << /Size " . (count($objects) + 1) . " /Root 1 0 R >>\nstartxref\n{$xref}\n%%EOF";
    file_put_contents($dest, $pdf);
    return count($pages);
}
