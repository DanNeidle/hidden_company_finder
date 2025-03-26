#!/usr/bin/env python3
import json
import csv

# uses list of issuers from https://www.londonstockexchange.com/reports?tab=issuers
listed_company_file = 'pscs_uk_listed_companies.txt'

# snapshot from https://download.companieshouse.gov.uk/en_output.html
# note that some column headings have white space at the start
SNAPSHOT_FILE = 'BasicCompanyDataAsOneFile-2025-03-01.csv'

# Input and output file paths
input_file = "pscs_list_of_non-uk_corp_pscs_geo_and_details.json"
output_file = "pscs_list_of_non-uk_corp_pscs_v2.json"




def load_snapshot_data():
    snapshot_data = {}
    # Load the CSV file into memory once.
    with open(SNAPSHOT_FILE, newline='', encoding='utf-8') as csvfile:
        reader = csv.DictReader(csvfile)
        for row in reader:
            company_number = row[' CompanyNumber']
            # Convert empty strings to None for the dissolution date.
            dissolution_date = row['DissolutionDate'] if row['DissolutionDate'] else None
            incorporation_date = row['IncorporationDate']
            company_status = row['CompanyStatus']
            # Concatenate SIC codes, only including non-empty values.
            sic_codes = ','.join(
                [row[field] for field in ["SICCode.SicText_1", "SICCode.SicText_2", 
                                            "SICCode.SicText_3", "SICCode.SicText_4"] if row[field]]
            )
            snapshot_data[company_number] = (dissolution_date, incorporation_date, company_status, sic_codes)
    return snapshot_data

def find_company_data(company_number):
    """
    Given a company number, return a tuple with:
    (dissolution_date, incorporation_date, company_status, concatenated SIC codes).
    If the company is not found, returns a tuple of (None, None, None, '').
    """
    return company_data.get(company_number, (None, None, None, ''))


print("loading snapshot")
company_data = load_snapshot_data()

print("Loading psc json")
with open(input_file, "r", encoding="utf-8") as infile:
    records = json.load(infile)

new_records = []
for idx, record in enumerate(records): 
    company_number = record.get("company_number")
    company_name = record.get("company_details", {}).get("company_name")
    if not company_number:
        print(f"ERROR: can't find company number for {company_name}")
        print(record)
        exit(1)
    dissolution_date, incorporation_date, company_status, SICs = find_company_data(company_number)
    if company_status is None:
        print(f"{company_name}: no info")
    else:
        print(f"{company_name}: {SICs}")
        record["company_details"]["dissolution_date"] = dissolution_date
        record["company_details"]["incorporation_date"] = incorporation_date
        record["company_details"]["company_status"] = company_status
        record["company_details"]["SICs"] = SICs

    new_records.append(record)

# Export the new records to the output file.
with open(output_file, "w", encoding="utf-8") as outfile:
    json.dump(new_records, outfile, indent=2)

print(f"Exported {len(new_records)} records to {output_file}")
