#!/usr/bin/env python3
import json
import string

# uses list of issuers from https://www.londonstockexchange.com/reports?tab=issuers
listed_company_file = 'pscs_uk_listed_companies.txt'

# Input and output file paths
input_file = "non-uk_corp_pscs_geo_and_details-with-uk-listed.json"
output_file = "pscs_list_of_non-uk_corp_pscs_geo_and_details.json"

# Load the listed companies from the file into a set for efficient lookup
def load_listed_companies(filepath):
    translator = str.maketrans('', '', string.punctuation)
    with open(filepath, 'r', encoding='utf-8') as file:
        return set(line.strip().lower().translate(translator) for line in file)

# Check if the company is listed
def is_company_uk_listed(company, listed_companies_set):
    translator = str.maketrans('', '', string.punctuation)
    cleaned_company = company.strip().lower().translate(translator)
    return cleaned_company in listed_companies_set



listed_companies = load_listed_companies(listed_company_file)


with open(input_file, "r", encoding="utf-8") as infile:
    records = json.load(infile)

new_records = []
listed_count = 0
for idx, record in enumerate(records): 
    name = record.get("data").get("name")
    if is_company_uk_listed(name, listed_companies  ):
        print(f"{idx}: {name} is UK listed")
        listed_count += 1
        continue
    new_records.append(record)

# Export the new records to the output file.
with open(output_file, "w", encoding="utf-8") as outfile:
    json.dump(new_records, outfile, indent=2)

print(f"Exported {len(new_records)} records to {output_file}, removing {listed_count} listed companies")
