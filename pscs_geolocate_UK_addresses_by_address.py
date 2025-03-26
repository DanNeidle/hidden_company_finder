#!/usr/bin/env python3
import json
import time
import requests


"""
Using the nominatim api is (1) rather antisocial and (2) very slow. So instead suggest installing
nominatim locally with:

docker run -it \
  -e PBF_URL=https://download.geofabrik.de/europe/great-britain-latest.osm.pbf \
  -e REPLICATION_URL=https://download.geofabrik.de/europe/great-britain-updates/ \
  -p 8080:8080 \
  --name nominatim \
  mediagis/nominatim:4.5ß

"""

# Input and output file paths
input_file = "pscs_list_of_non-uk_corp_pscs_v3.3-with-postcode-and-address-lookup-with-api.json"
output_file = "pscs_list_of_non-uk_corp_pscs_v3.4-additional-addresses.json"

DEBUG_LIMIT = None
NOMINATIM_URL = "http://192.168.1.53:8080/search"

def query_nominatim(address, timeout=10):
    params = {"q": address, "format": "json"}
    try:
        response = requests.get(NOMINATIM_URL, params=params, timeout=timeout)
        response.raise_for_status()
        results = response.json()
        if results:
            # Use the first result found
            result = results[0]
            lat = result.get("lat")
            lon = result.get("lon")
            if lat and lon:
                return lat, lon
    except Exception as e:
        print(f"Error querying Nominatim for address '{address}': {e}")
    return None, None

def join_address_parts(parts):
    # Join non-empty, stripped parts with a comma and a space.
    filtered = [p.strip() for p in parts if p.strip()]
    return ", ".join(filtered) if filtered else ""

def recursive_search(parts, tried=None):
    """
    Given a list of address parts, recursively try every combination of removals.
    Returns (lat, lon) if found, otherwise (None, None).
    """
    if tried is None:
        tried = set()

    address = join_address_parts(parts)
    if address in tried:
        return None, None
    tried.add(address)

    # Try the current combination.
    lat, lon = query_nominatim(address)
    if lat and lon:
        return lat, lon

    # If there is only one part left, nothing to remove further.
    if len(parts) <= 1:
        return None, None

    # Try removing one part at a time.
    for i in range(len(parts)):
        new_parts = parts[:i] + parts[i+1:]
        lat, lon = recursive_search(new_parts, tried)
        if lat and lon:
            return lat, lon
    return None, None

def get_lat_lon_modified(address):
    """
    Attempts to get lat/lon for the full address. If not found, falls back:
      1. Remove the last comma-separated part.
      2. Remove the first comma-separated part.
      3. If still not found, do an exhaustive recursive search.
    """
    # Try full address.
    print(f"Trying full address: '{address}'")
    lat, lon = query_nominatim(address)
    if lat and lon:
        return lat, lon

    # Split into parts.
    parts = [p.strip() for p in address.split(",")]
    if len(parts) > 1:
        # 1. Remove the last part.
        attempt = join_address_parts(parts[:-1])
        print(f"Trying without last part: '{attempt}'")
        lat, lon = query_nominatim(attempt)
        if lat and lon:
            return lat, lon

        # 2. Remove the first part.
        attempt = join_address_parts(parts[1:])
        print(f"Trying without first part: '{attempt}'")
        lat, lon = query_nominatim(attempt)
        if lat and lon:
            return lat, lon

        # 3. Optionally, try removing both first and last parts if there are enough parts.
        if len(parts) > 2:
            attempt = join_address_parts(parts[1:-1])
            print(f"Trying without first and last parts: '{attempt}'")
            lat, lon = query_nominatim(attempt)
            if lat and lon:
                return lat, lon

    # If these simple removals failed, do an exhaustive recursive search.
    print("Starting exhaustive recursive search...")
    lat, lon = recursive_search(parts)
    if lat and lon:
        print("Exhaustive search succeeded.")
    else:
        print("Exhaustive search failed.")
    return lat, lon


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
        
    address = company_details.get("address")
        
    if company_details.get("lat"):
        print(f"{idx}: {company_name}: already geolocated")
        already += 1
        
    elif not address:
        print(f"{idx}: {company_name}: no address")
        print("")
        print(record)
        exit()
        fail += 1
        
    else:
        lat, lon = get_lat_lon_modified(address)
        
        if lat:
            print(f"{idx}: {company_name}: geolocated to {lat, lon}")
            company_details["lat"], company_details["lon"] = lat, lon
            success += 1
        
        else:
            print(f"{idx}: {company_name}: can't geolocate {address}")
            fail += 1

    new_records.append(record)

# Export the new records to the output file.
with open(output_file, "w", encoding="utf-8") as outfile:
    json.dump(new_records, outfile, indent=2)

print(f"\nExported {len(new_records)} records to {output_file}")
print(f"{success} geolocated")
print(f"{already} already geolocated")
print(f"{fail} failed")
