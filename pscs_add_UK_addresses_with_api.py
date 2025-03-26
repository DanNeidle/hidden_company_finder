#!/usr/bin/env python3
import json
import time
import requests
from companies_house_settings import companies_house_api_key
from pyproj import Transformer
import glob
import pandas as pd
import os

DEBUG_LIMIT = 1e9

# Input and output file paths
input_file = "pscs_list_of_non-uk_corp_pscs_v3-with-postcode-and-address-lookup.json"
output_file = "pscs_list_of_non-uk_corp_pscs_v3.3-with-postcode-and-address-lookup-with-api.json"

SIC_CODE_LOOKUP_FILE = "sic_codes.json"

def load_list_of_sic_codes():
    """Load the SIC code lookup file into a dictionary."""
    with open(SIC_CODE_LOOKUP_FILE, 'r') as f:
        return json.load(f)
    

def create_sic_code_text(sic_codes):
    """
    Given a list of SIC codes and a lookup dictionary,
    returns a string with each code followed by its description,
    separated by a comma.
    """
    return ', '.join(f"{code} {sic_code_lookup.get(code, 'Unknown')}" for code in sic_codes)


def get_company_details_from_api(company_number, company_details):
    
    url = f"https://api.company-information.service.gov.uk/company/{company_number}"
    while True:
                
        try:
            response = requests.get(url, auth=(companies_house_api_key, ''))
            
            if response.status_code == 200:
                break
            
            elif response.status_code == 404:
                # print(f"Can't find company {company_name}: HTTP {response.status_code}...")
                return company_details
            else:
                print(f"Error fetching details for company {company_name}: HTTP {response.status_code}. Retrying in 10 seconds...")
                time.sleep(10)
                
        except requests.RequestException as e:
            print(f"Error fetching details for company {company_name}: {e}. Retrying in 10 seconds...")
            time.sleep(10)
            
    profile = response.json()
    
    company_details["accounts_overdue"] = profile.get("accounts", {}).get("next_accounts", {}).get("overdue", False)
    company_details["registered_office_is_in_dispute"] = profile.get("registered_office_is_in_dispute", False)
    company_details["accounts_type"] = profile.get("accounts", {}).get("last_accounts", {}).get("type")
    company_details["undeliverable_registered_office_address"] = profile.get("undeliverable_registered_office_address", False)
    company_details["dissolution_date"] = profile.get("date_of_cessation")
    company_details["incorporation_date"] = profile.get("date_of_creation")
    company_details["company_status"] = profile.get("company_status")
    company_details["SICs"] = create_sic_code_text(profile.get("sic_codes", []))
    company_details["postcode"] = profile.get("registered_office_address", {}).get("postal_code", {})
    company_details["address"] = ', '.join(str(v) for v in profile.get("registered_office_address", {}).values())

    return company_details      


# Helper function to convert eastings/northings to latitude/longitude.
def convert_bng(easting, northing):
    transformer = Transformer.from_crs("EPSG:27700", "EPSG:4326", always_xy=True)
    lon, lat = transformer.transform(easting, northing)
    return lat, lon

def load_all_postcode_csvs(csv_folder='codepo_gb/Data/CSV'):
    """
    Loads all CSV files from the specified folder into a single DataFrame.
    Assumes each CSV file:
      - Has no header.
      - Uses comma as the delimiter.
      - Follows the column order defined in COLUMN_NAMES.
    
    Returns:
      pandas.DataFrame: DataFrame containing data from all CSV files.
    """
    
    print("\nLoading all postcode CSVs")

    # Define the column names as per the ordnance survey CSV specification.
    COLUMN_NAMES = [
        "Postcode",
        "Positional_quality_indicator",
        "Eastings",
        "Northings",
        "Country_code",
        "NHS_regional_HA_code",
        "NHS_HA_code",
        "Admin_county_code",
        "Admin_district_code",
        "Admin_ward_code"
    ]
    # Find all CSV files in the folder.
    csv_files = glob.glob(os.path.join(csv_folder, '*.csv'))
    dataframes = []
    
    for csv_file in csv_files:
        try:
            df = pd.read_csv(csv_file, delimiter=',', header=None, names=COLUMN_NAMES)
            dataframes.append(df)
        except Exception as e:
            print(f"Error reading {csv_file}: {e}")
    
    if dataframes:
        # Concatenate all dataframes.
        all_data = pd.concat(dataframes, ignore_index=True)
        # Normalize the 'Postcode' column for consistent lookups.
        all_data['Postcode'] = all_data['Postcode'].astype(str).str.strip().str.upper()
        return all_data
    else:
        return pd.DataFrame(columns=COLUMN_NAMES)



def convert_uk_postcode_to_latlon(postcode):
    """
    Given a UK postcode, look up the eastings and northings from the preloaded DataFrame
    and convert them to latitude and longitude.
    
    Parameters:
      postcode (str): The UK postcode (e.g. "AB1 5XS").
    
    Returns:
      tuple: (lat, lon) if found, else None.
    """
    if postcode is None:
        return None, None
    
    # Normalize the input postcode.
    postcode = postcode.strip().upper()
    
    # Filter the DataFrame for the matching postcode.
    match = POSTCODE_DATA[POSTCODE_DATA['Postcode'] == postcode]
    if match.empty:
        print(f"Postcode {postcode} not found in data.")
        return None, None
    
    # Use the first matching row.
    row = match.iloc[0]
    
    # Extract eastings and northings and ensure they are numeric.
    try:
        eastings = float(row['Eastings'])
        northings = float(row['Northings'])
    except Exception as e: 
        print(f"Error converting eastings/northings for {postcode}: {e}")
        return None, None

    # Convert to latitude/longitude.
    lat, lon = convert_bng(eastings, northings)
    return lat, lon


print("Loading SIC codes")
sic_code_lookup = load_list_of_sic_codes()

      
POSTCODE_DATA = load_all_postcode_csvs()

print("Loading psc json")
with open(input_file, "r", encoding="utf-8") as infile:
    records = json.load(infile)


success = 0
success_and_geo = 0
already = 0
fail = 0

new_records = []
for idx, record in enumerate(records):
    
    if DEBUG_LIMIT and idx > DEBUG_LIMIT:
        print("DEBUG LIMIT REACHED")
        break
    
    company_details = record.get("company_details", {})
    company_number = record.get("company_number")
    company_name = company_details.get("company_name")
    if not company_number:
        print(f"ERROR: can't find company number for {company_name}")
        print(record)
        exit(1)
        
    address = record.get("company_details", {}).get("address")
        
    if address:
        print(f"{idx}: {company_number} already have address")
        already += 1
    
    else:
        
        company_details = get_company_details_from_api(company_number, company_details)
        
        postcode = company_details.get("postcode")

        if postcode:
            lat, lon = convert_uk_postcode_to_latlon(postcode)
            if lat and lon:
                company_details["lat"] = lat
                company_details["lon"] = lon
                print(f"{idx}: {company_number} ({company_name}) geolocated to {lat, lon}")
                success_and_geo += 1
            else:
                print(f"{idx}: {company_number} ({company_name}) can't geolocate")
                success += 1
                
        elif address:
            print(f"{idx}: {company_number} ({company_name}) no postcode")
            success += 1
        else:
            print(f"{idx}: {company_number} ({company_name}) no information obtained")
            fail += 1
    
    new_records.append(record)

# Export the new records to the output file.
with open(output_file, "w", encoding="utf-8") as outfile:
    json.dump(new_records, outfile, indent=2)

print(f"Exported {len(new_records)} records to {output_file}")

print(f"{success_and_geo} added all data")
print(f"{success} added but couldn't geolocate")
print(f"{already} already had address")
print(f"{fail} failed")

