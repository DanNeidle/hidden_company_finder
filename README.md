# hidden_company_finder
A collection of scripts to create a list of UK companies whose identity is being hidden. More details https://taxpolicy.org.uk/2025/03/19/50000-uk-companies-fail-to-declare-their-beneficial-owner/

(c) Dan Neidle of Tax Policy Associates Ltd, 2025
Licensed under the GNU General Public License, version 2

pscs_find_non-UK_corporates.py is run first, and processes the Companies House PSC snapshot to generate a text file of all the PSCs who are non-UK corporates
pscs_find_geodata.py then geoencodes the PSCs and outputs a json. The other files output jsons with successively greater detail. The final json can be found at https://taxpolicy.org.uk/wp-content/assets/pscs_list_of_non-uk_corp_pscs_v3.5.json

The webapp provides a user interface for the final json

the scripts are not very well organised. Hopefully they may be of some use to others, but unfortunately we can't provide any support.
