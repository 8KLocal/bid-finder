/** USPS codes and Census state FIPS. Public geography only. */

export const USPS = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","DC","FL","GA","HI","ID","IL","IN","IA","KS",
  "KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC",
  "ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY",
];

export const FIPS = {
  "01":"AL","02":"AK","04":"AZ","05":"AR","06":"CA","08":"CO","09":"CT","10":"DE","11":"DC",
  "12":"FL","13":"GA","15":"HI","16":"ID","17":"IL","18":"IN","19":"IA","20":"KS","21":"KY",
  "22":"LA","23":"ME","24":"MD","25":"MA","26":"MI","27":"MN","28":"MS","29":"MO","30":"MT",
  "31":"NE","32":"NV","33":"NH","34":"NJ","35":"NM","36":"NY","37":"NC","38":"ND","39":"OH",
  "40":"OK","41":"OR","42":"PA","44":"RI","45":"SC","46":"SD","47":"TN","48":"TX","49":"UT",
  "50":"VT","51":"VA","53":"WA","54":"WV","55":"WI","56":"WY",
};

const NAMES = {
  alabama:"AL", alaska:"AK", arizona:"AZ", arkansas:"AR", california:"CA", colorado:"CO",
  connecticut:"CT", delaware:"DE", "district of columbia":"DC", florida:"FL", georgia:"GA",
  hawaii:"HI", idaho:"ID", illinois:"IL", indiana:"IN", iowa:"IA", kansas:"KS", kentucky:"KY",
  louisiana:"LA", maine:"ME", maryland:"MD", massachusetts:"MA", michigan:"MI", minnesota:"MN",
  mississippi:"MS", missouri:"MO", montana:"MT", nebraska:"NE", nevada:"NV", "new hampshire":"NH",
  "new jersey":"NJ", "new mexico":"NM", "new york":"NY", "north carolina":"NC", "north dakota":"ND",
  ohio:"OH", oklahoma:"OK", oregon:"OR", pennsylvania:"PA", "rhode island":"RI", "south carolina":"SC",
  "south dakota":"SD", tennessee:"TN", texas:"TX", utah:"UT", vermont:"VT", virginia:"VA",
  washington:"WA", "west virginia":"WV", wisconsin:"WI", wyoming:"WY", "puerto rico":"PR",
  guam:"GU", "virgin islands":"VI", "american samoa":"AS", "northern mariana islands":"MP",
};

const FOREIGN = /\b(canada|ontario|quebec|british columbia|alberta|manitoba|saskatchewan|mexico|united kingdom|\bu\.k\.\b|\buk\b|england|scotland|wales|ireland|india|australia|germany|france|spain|italy|china|japan|brazil|philippines|nigeria|singapore|netherlands|sweden|poland|south africa|kenya|uae|dubai|qatar|saudi|korea|taiwan|vietnam|thailand|indonesia|malaysia|new zealand|pakistan|bangladesh|egypt|colombia|argentina|chile|peru|israel|europe|tbilisi|republic of georgia)\b/i;

export function stateCode(value) {
  const text = String(value || "").replace(/\./g, "").trim();
  if (!text) return "";
  const upper = text.toUpperCase();
  if (USPS.includes(upper) || ["PR","VI","GU","AS","MP"].includes(upper)) return upper;
  return NAMES[text.toLowerCase()] || "";
}

/** Pull a USPS code from a place string such as "Austin, Texas" or "USA (Virginia)". */
export function stateFromPlace(place) {
  const text = String(place || "").replace(/\s+/g, " ").trim();
  if (!text || FOREIGN.test(text)) {
    const rescued = text.match(/,\s*([A-Za-z .]+)$/);
    if (!rescued || FOREIGN.test(text)) {
      if (FOREIGN.test(text) && !/\b(united states|u\.s\.a\.|usa)\b/i.test(text)) return "";
    }
  }
  const tail = text.match(/,\s*([A-Za-z .]+)$/);
  if (tail) {
    const code = stateCode(tail[1]);
    if (code) return code;
  }
  const wrapped = text.match(/\b(?:USA|United States)\s*\(([^)]+)\)/i);
  if (wrapped) {
    const code = stateCode(wrapped[1].split(",")[0]);
    if (code) return code;
  }
  return stateCode(text);
}

export function looksForeign(place, country = "") {
  const blob = `${country} ${place}`.replace(/\s+/g, " ").trim();
  if (!blob) return false;
  if (/\b(united states|u\.s\.a\.|usa)\b/i.test(blob) && !FOREIGN.test(country || "")) return false;
  return FOREIGN.test(blob);
}
