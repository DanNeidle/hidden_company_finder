#!/usr/bin/env python3
import json
from pyproj import Transformer
import glob
import pandas as pd
import os

# Input and output file paths
input_file = "pscs_list_of_non-uk_corp_pscs_v3.3-with-postcode-and-address-lookup-with-api.json"
output_file = "pscs_list_of_non-uk_corp_pscs_v3.4-with-more-postcodes.json"

DEBUG_LIMIT = None

###################UK POSTCODE LOOKUP
# uses ordnance survey postcode database from: https://geoportal.statistics.gov.uk/datasets/ons::ons-postcode-directory-november-2022-for-the-uk/about


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

POSTCODE_DATA = load_all_postcode_csvs()

print("Loading psc json")
with open(input_file, "r", encoding="utf-8") as infile:
    records = json.load(infile)

new_records = []
already = 0
success = 0
fail = 0


for idx, record in enumerate(records): 
    
    if DEBUG_LIMIT and idx > DEBUG_LIMIT:
        print("DEBUG LIMIT REACHED")
        break
    
    company_number = record.get("company_number")
    company_details = record.get("company_details", {})
    
    if not company_number:
        print(f"ERROR: can't find company number for {company_name}")
        print(record)
        exit(1)
    
    company_name = company_details.get("company_name")
    if not company_name:
        print(f"ERROR: can't find company name for {company_number}")
        print(record)
        exit(1)
        
    postcode = company_details.get("postcode")
    address = company_details.get("address")
        
    if company_details.get("lat"):
        print(f"{idx}: {company_name}: already geolocated")
        already += 1
        
    elif not postcode:
        print(f"{idx}: {company_name}: no postcode")
        fail += 1
        
    else:
        lat, lon = convert_uk_postcode_to_latlon(postcode)
        
        if lat:
            print(f"{idx}: {company_name}: geolocated {postcode} to {lat, lon}")
            company_details["lat"], company_details["lon"] = lat, lon
            success += 1
        
        else:
            print(f"{idx}: {company_name}: can't geolocate {postcode}")
            fail += 1

    new_records.append(record)

# Export the new records to the output file.
with open(output_file, "w", encoding="utf-8") as outfile:
    json.dump(new_records, outfile, indent=2)

print(f"\nExported {len(new_records)} records to {output_file}")
print(f"{success} geolocated")
print(f"{already} already geolocated")
print(f"{fail} failed")
