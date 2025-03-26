#!/usr/bin/env python3
import json
from rapidfuzz import fuzz


# Input and output file paths
input_file = "uk_corp_pscs_geo_and_details.json"
output_file = "non-uk_corp_pscs_geo_and_details.json"


def is_uk_a_fuzzy_match(country, threshold=85):
    
    if country is None or country == "":
        return False
    
    """Determine if a country string is considered UK by fuzzy matching."""
    normalized = country.lower().replace("registered in", "").strip()
    uk_terms = [
        "uk", "england", "scotland", "wales", "northern ireland", "united kingdom",
        "england and wales", "england & wales", "united kingdom (england and wales)",
        "uk and wales", "united kingdom england", "u.k", "england, uk",
        "scotland united kingdom", "gbeng", "gbsct", "great britain", "united kingdom (scotland)", "london",
        "gbr", "cardiff", "e&w", "england, united kingdom", "britain", "uk/england", "cardiff, wales", "uk/scotland",
        "gb", "companies house", "n. ireland", "edinburgh", "uk, yorkshire", "Companies House - Registrar Of Companies", 
        "Northern Ireland, United Kingdom", "london, england", "belfast", "eng", "u k", "england and wales, england", 
        "west yorkshire ", "scottish", "Wales Uk", "cymru", "suffolk", "Law Of England And Wales"
    ]
    for term in uk_terms:
        if fuzz.ratio(normalized, term) >= threshold:
            return True
    return False

with open(input_file, "r", encoding="utf-8") as infile:
    records = json.load(infile)

new_records = []
for idx, record in enumerate(records): 
    country = record.get("data").get("address").get("country")
    
    legal_authority = record.get("data").get("identification").get("legal_authority")
    country_registered = record.get("data").get("identification").get("country_registered")
    legal_form = record.get("data").get("identification").get("legal_form")

    name = record.get("data").get("name")
    if is_uk_a_fuzzy_match(country) or is_uk_a_fuzzy_match(legal_authority) or is_uk_a_fuzzy_match(country_registered) or is_uk_a_fuzzy_match(legal_form):
        print(f"{idx}: {name} - {country} is UK")
        continue
    print(f"{idx}: {name} - {country} is not UK")
    new_records.append(record)

# Export the new records to the output file.
with open(output_file, "w", encoding="utf-8") as outfile:
    json.dump(new_records, outfile, indent=2)

print(f"Exported {len(new_records)} records to {output_file}")
