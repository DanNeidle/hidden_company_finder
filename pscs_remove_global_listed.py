
#!/usr/bin/env python3
import json
import string
from rapidfuzz import fuzz
import re

# removing all listed companies on the face of it is wrong, because they won't all be regulated markets
# but even if not, unlikely anyone will have 25%

# check if goldman sachs still there!

# list is from https://public.acho.io/embed/9bffe75f11a5a99349359c98c74b9b0ba41cf563b351ffbb7ecc19614706f827861e5171a35b6f8296aa1d43a7558cfb978ae74ac969094d1c991bf7d8c8ca9f
global_listed_csv = "Global_stock_listings_by_exchange_174.csv"
listed_excluded = 0

# Input and output file paths
input_file = "pscs_list_of_non-uk_corp_pscs_v3.4.json"
output_file = "pscs_list_of_non-uk_corp_pscs_v3.5.json"


def normalize_text(text):
    """Lowercase, remove punctuation, common corporate suffixes, class/series tokens, and extra whitespace."""
    text = text.lower()
    # Remove punctuation (keep alphanumerics and spaces)
    text = re.sub(r'[^a-z0-9\s]', '', text)
    # Define tokens to remove (as whole words)
    tokens_to_remove = ['inc', 'llc', 'ltd', 'corp', 'corporation', 'class', 'series']
    pattern = r'\b(?:' + '|'.join(tokens_to_remove) + r')\b'
    text = re.sub(pattern, '', text)
    # Remove common stock if present
    text = text.replace("common stock", "")
    # Normalize whitespace
    text = re.sub(r'\s+', ' ', text)
    return text.strip()


def load_listing_names(filename, delimiter, company_name_col, skip_header=True):
    """
    Load company names from a file.
      - filename: path to file.
      - delimiter: string delimiter.
      - company_name_col: zero-based index for the company name column.
      - skip_header: whether to skip the first line.
    Returns a list of normalized company names.
    """
    listing_names = []
    with open(filename, "r", encoding="utf-8") as f:
        for i, line in enumerate(f):
            if skip_header and i == 0:
                continue
            parts = line.strip().split(delimiter)
            if len(parts) > company_name_col:
                name = parts[company_name_col]
                normalized = normalize_text(name)
                listing_names.append(normalized)
    return listing_names

# Load the listing names from the three files.
global_listings = load_listing_names(global_listed_csv, delimiter=",", company_name_col=2)


def is_listed_company(psc_name, threshold=95):
    """
    Check if a PSC company name (already normalized) fuzzy matches
    any of the known listed companies (also normalized).
    """
    
    normalised_name = normalize_text(psc_name)
    # print(f"Normalised to {normalised_name}")
    for listed in global_listings:
        if fuzz.ratio(normalised_name, listed) >= threshold:
            # print(f"{psc_name} is listed - {listed}")
            return True
    return False

# a good test:
# print(is_listed_company("Spire Global, Inc."))


with open(input_file, "r", encoding="utf-8") as infile:
    records = json.load(infile)

new_records = []
listed_count = 0
for idx, record in enumerate(records): 
    name = record.get("data").get("name")
    if is_listed_company(name):
        print(f"{idx}: {name} is listed")
        listed_count += 1
        continue
    new_records.append(record)

# Export the new records to the output file.
with open(output_file, "w", encoding="utf-8") as outfile:
    json.dump(new_records, outfile, indent=2)

print(f"Exported {len(new_records)} records to {output_file}, removing {listed_count} listed companies")
