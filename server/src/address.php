<?php
declare(strict_types=1);

function normalize_us_address(array $input): array
{
    $name = trim((string) ($input['name'] ?? ''));
    $line1 = trim((string) ($input['line1'] ?? ''));
    $line2 = trim((string) ($input['line2'] ?? ''));
    $city = trim((string) ($input['city'] ?? ''));
    $state = strtoupper(trim((string) ($input['state'] ?? '')));
    $zip = trim((string) ($input['zip'] ?? ''));
    $states = ['AL','AK','AZ','AR','CA','CO','CT','DE','DC','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','PR','VI','GU','AS','MP'];
    $names = ['ALABAMA'=>'AL','ALASKA'=>'AK','ARIZONA'=>'AZ','ARKANSAS'=>'AR','CALIFORNIA'=>'CA','COLORADO'=>'CO','CONNECTICUT'=>'CT','DELAWARE'=>'DE','DISTRICT OF COLUMBIA'=>'DC','FLORIDA'=>'FL','GEORGIA'=>'GA','HAWAII'=>'HI','IDAHO'=>'ID','ILLINOIS'=>'IL','INDIANA'=>'IN','IOWA'=>'IA','KANSAS'=>'KS','KENTUCKY'=>'KY','LOUISIANA'=>'LA','MAINE'=>'ME','MARYLAND'=>'MD','MASSACHUSETTS'=>'MA','MICHIGAN'=>'MI','MINNESOTA'=>'MN','MISSISSIPPI'=>'MS','MISSOURI'=>'MO','MONTANA'=>'MT','NEBRASKA'=>'NE','NEVADA'=>'NV','NEW HAMPSHIRE'=>'NH','NEW JERSEY'=>'NJ','NEW MEXICO'=>'NM','NEW YORK'=>'NY','NORTH CAROLINA'=>'NC','NORTH DAKOTA'=>'ND','OHIO'=>'OH','OKLAHOMA'=>'OK','OREGON'=>'OR','PENNSYLVANIA'=>'PA','RHODE ISLAND'=>'RI','SOUTH CAROLINA'=>'SC','SOUTH DAKOTA'=>'SD','TENNESSEE'=>'TN','TEXAS'=>'TX','UTAH'=>'UT','VERMONT'=>'VT','VIRGINIA'=>'VA','WASHINGTON'=>'WA','WEST VIRGINIA'=>'WV','WISCONSIN'=>'WI','WYOMING'=>'WY'];
    if (isset($names[$state])) {
        $state = $names[$state];
    }
    if ($name === '' || strlen($name) > 80) {
        throw new InvalidArgumentException('Enter the recipient or sender name.');
    }
    if ($line1 === '' || strlen($line1) > 80) {
        throw new InvalidArgumentException('Enter a street address.');
    }
    if ($city === '' || strlen($city) > 40) {
        throw new InvalidArgumentException('Enter a city.');
    }
    if (!in_array($state, $states, true)) {
        throw new InvalidArgumentException('Enter a U.S. state as a two-letter code.');
    }
    if (!preg_match('/^\d{5}(-\d{4})?$/', $zip)) {
        throw new InvalidArgumentException('Enter a ZIP code as 12345 or 12345-6789.');
    }
    $parts = preg_split('/\s+/', $name, 2) ?: [$name];
    return [
        'name' => $name,
        'first' => $parts[0],
        'last' => $parts[1] ?? $parts[0],
        'line1' => $line1,
        'line2' => $line2,
        'city' => $city,
        'state' => $state,
        'zip' => $zip,
    ];
}
