/**
 * © Tax Policy Associates Ltd 2025, and licensed under the Creative Commons BY-SA 4.0 licence (unless stated otherwise).
 * You may freely use and adapt any of our original material for any purpose, provided you attribute it to Tax Policy Associates Ltd.
 * We’d appreciate it if you let us know, but you don't have to.
 *
 * This script uses the following third-party libraries:
 * - jQuery (© 2005–2025, licensed under the MIT License)
 * - Leaflet (© 2010–2025, licensed under the BSD 2-Clause License)
 * - Leaflet.markercluster (licensed under the MIT License)
 * - Leaflet.Control.Geocoder (licensed under the MIT License)
 * - Leaflet.PolylineDecorator (licensed under the MIT License)
 * - Leaflet.draw (licensed under the MIT License)
 * - LZ-String (licensed under the MIT License)
 * - Shepherd.js (licensed under the MIT Licence)
 */

const APP_VERSION = "v3.55";


/*********************** CONFIGURATION & GLOBAL VARIABLES **************************/
/* global $, L, LZString, bootstrap, Shepherd */
let activeMarker = null;                                  // Currently active (opened) marker
let useUKCompanyLocation = false;                         // false = PSC mode (default), true = UK company mode

let linkLayers = [];    // Array to hold all drawn polylines
let giantMarkers = [];  // Array to hold all extra (big) markers

let drawnLayer = null;

let linkedPSCIds = [];


// Maximum number of items to load - when developing/debugging, set to e.g. 1000
const debug_limit = 1e9;                                  

// Initialize map at a global view
const map = L.map('map', { center: [54, -2], zoom: 2, zoomControl: false, attributionControl: false });
map.on("popupopen", e => activeMarker = e.popup._source);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { worldCopyJump: true, noWrap: false }).addTo(map);

// Marker clusters for different categories
const markerClusters = {
    green: L.markerClusterGroup({ showCoverageOnHover: false }),
    orange: L.markerClusterGroup({ showCoverageOnHover: false }),
    red: L.markerClusterGroup({ showCoverageOnHover: false }),
    grey: L.markerClusterGroup({ showCoverageOnHover: false }),
    black: L.markerClusterGroup({ showCoverageOnHover: false })
  };

// Add default layers to map
map.addLayer(markerClusters.green);
map.addLayer(markerClusters.orange);
map.addLayer(markerClusters.red);

// Arrays to keep track of markers (for search and reference)
let markersArray = [];
let markersByCategory = { green: [], orange: [], red: [], grey: [], black: [] };


/*********************** HELPER FUNCTIONS **************************/

/**
 * Create a big marker icon (for endpoints of a link).
 */
function createBigIcon(markerColor) {
    return L.divIcon({
      html: `<div style="background-color:${markerColor}; width:24px; height:24px; border-radius:50%; border:2px solid black;"></div>`,
      className: '',
      iconSize: [24, 24]
    });
  }


// Convert a comma-separated string to title case.
function toTitleCase(str) {
    return str.split(',')
            .map(part => part.trim()
                                .split(' ')
                                .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
                                .join(' '))
            .join(', ');
}

// Determine marker color based on company details.
function getMarkerColor(company_status, ceased_on, accounts_overdue, registered_office_is_in_dispute, undeliverable_registered_office_address, accounts_type) {
    if (company_status !== "Active") return "black";
    if (ceased_on) return "grey";
    if (accounts_overdue || registered_office_is_in_dispute || undeliverable_registered_office_address) return "red";
    if (accounts_type === "dormant") return "orange";
    return "green";
}

// Generate the popup HTML for a marker.
function generatePopup(psc_html, address_text, uk_company_html, uk_company_address, incorporation_date, company_status, warnings_html, accounts_type, SICs, companyId) {
    let popup = `<b>PSC: ${psc_html}</b><br>${address_text}<br><br>Owner of ${uk_company_html}`;
    if (uk_company_address) {
      popup += `<br>${uk_company_address}`;
    }
    popup += `<br>Incorporated ${incorporation_date}, ${company_status}`;
    if (warnings_html) {
      popup += `<br><b>${warnings_html}</b>`;
    }
    popup += `<br><br>Accounting basis: ${accounts_type}<br>Stated industry codes: ${SICs}`;
    // Append the "Show Link" button with a data attribute holding the company id
    popup += `<br><br><button class="show-link" data-company="${companyId}">Show Link</button>`;
    return popup;
  }


// Clear all markers from clusters and reset tracking arrays.
function clearAllMarkers() {
    Object.keys(markerClusters).forEach(category => {
    markerClusters[category].clearLayers();
    });
    markersArray = [];
    markersByCategory = { green: [], orange: [], red: [], grey: [], black: [] };
}

// Mode switch: update marker data and adjust map view.
function switchMode(isUKMode) {
    useUKCompanyLocation = isUKMode;
    clearAllMarkers();
    loadMarkers();
    if (useUKCompanyLocation) {
    map.setView([55, -2], 6); // Zoom in to UK
    } else {
    map.setView([54, -2], 2); // Global view
    }
}

// Restore URL parameters (if any) to set view and open a marker.
function applyUrlParameters() {
    const params = new URLSearchParams(window.location.search);
    
    if (params.has("s")) {
      // Decompress and parse the state object.
      const compressedState = params.get("s");
      const decompressed = LZString.decompressFromEncodedURIComponent(compressedState);

        try {
            const state = JSON.parse(decompressed);
            
            // Restore layer visibility if saved
            if (state.layers) {
                for (let cat in state.layers) {
                if (state.layers[cat]) {
                    if (!map.hasLayer(markerClusters[cat])) {
                    map.addLayer(markerClusters[cat]);
                    }
                } else {
                    if (map.hasLayer(markerClusters[cat])) {
                    map.removeLayer(markerClusters[cat]);
                    }
                }
                // Optionally update the legend's UI:
                const legendItem = document.querySelector(`.legend-item[data-category="${cat}"]`);
                if (legendItem) {
                    legendItem.setAttribute("data-active", state.layers[cat] ? "true" : "false");
                    if (state.layers[cat]) {
                    legendItem.classList.remove("inactive");
                    legendItem.querySelector(".legend-box").classList.remove("inactive");
                    } else {
                    legendItem.classList.add("inactive");
                    legendItem.querySelector(".legend-box").classList.add("inactive");
                    }
                }
                }
            }

            // Restore the map center and an initial view.
            map.setView([parseFloat(state.lat), parseFloat(state.lng)], parseInt(state.zoom));
            
            // Restore the links.
            if (state.links && Array.isArray(state.links)) {
            state.links.forEach(id => {
                const marker = findMarkerById(id);
                if (marker) {
                drawLinkForMarker(marker);
                if (linkedPSCIds.indexOf(id) === -1) {
                    linkedPSCIds.push(id);
                }
                }
            });
            $("#clearLinksButton").show();
            }

            
            
            // Finally, adjust the zoom level again after all links are drawn.
            map.setView([parseFloat(state.lat), parseFloat(state.lng)], parseInt(state.zoom));

            // And restore the active popup (if available).
            if (state.popup) {
                const marker = findMarkerById(state.popup);
                if (marker) {
                markerClusters[marker.category].zoomToShowLayer(marker, () => { marker.openPopup(); });
                }
            }
        } catch (e) {
            console.error("Error parsing compressed state", e);
        }

        
    }

  }
  
  

// Find a marker by its custom ID.
function findMarkerById(id) {
    for (const category in markersByCategory) {
    for (let marker of markersByCategory[category]) {
        if (marker.myId === id) return marker;
    }
    }
    return null;
}

function drawLinkForMarker(marker) {
    let ukCoords = null;
    let pscCoords = null;
  
    if (useUKCompanyLocation) {
      ukCoords = [marker.ukLat, marker.ukLon];
      pscCoords = [marker.pscLat, marker.pscLon];
    } else {
      const pscLatLng = marker.getLatLng();
      pscCoords = [pscLatLng.lat, pscLatLng.lng];
      // If UK company coordinates are missing, use PSC coordinates as fallback
      if (marker.ukLat && marker.ukLon) {
        ukCoords = [marker.ukLat, marker.ukLon];
      } else {
        ukCoords = [pscLatLng.lat, pscLatLng.lng];
      }
    }
    if (!ukCoords || !pscCoords || !ukCoords[0] || !pscCoords[0]) {
      console.warn("Missing coordinates for marker:", marker);
      return;
    }
    // Draw the polyline and store it.
    const newLink = L.polyline([ukCoords, pscCoords], { color: 'red', weight: 3 }).addTo(map);
    linkLayers.push(newLink);
  
    // Update the marker to the big icon.
    marker.setIcon(createBigIcon(marker.category));
  
    // Add an extra big marker for the opposite endpoint.
    const extraPos = useUKCompanyLocation ? pscCoords : ukCoords;
    const extraMarker = L.marker(extraPos, { icon: createBigIcon(marker.category) })
                          .bindPopup(marker.getPopup())
                          .addTo(map);
    giantMarkers.push(extraMarker);
  }
  

// this is a horrid hack to make sure the map is in the right place on mobiles
function scheduleInvalidateSize() {
    // Immediately invalidate
    map.invalidateSize();
    // Then try again after short delays
    setTimeout(() => map.invalidateSize(), 200);
    setTimeout(() => map.invalidateSize(), 400);
    setTimeout(() => map.invalidateSize(), 600);
  }
  
// this shows the hamburger menu during the tutorial
function showHamburger() {
    // Check if the device is mobile
    const isMobile = window.matchMedia('(max-width: 767px)').matches ||
                     window.matchMedia('(pointer: coarse) and (hover: none)').matches;
    if (!isMobile) {
      // Not mobile, no need to show the hamburger offcanvas
      return Promise.resolve();
    }
    
    const offcanvasEl = document.getElementById('mobileControlsOffcanvas');
    let bsOffcanvas = bootstrap.Offcanvas.getInstance(offcanvasEl) || new bootstrap.Offcanvas(offcanvasEl);
    bsOffcanvas.show();
    
    // Wait for a short delay (e.g., 300ms) to allow the offcanvas to slide in
    return new Promise(resolve => setTimeout(resolve, 300));
  }

// yum cookies

  function setCookie(name, value, days) {
    let expires = "";
    if (days) {
      const date = new Date();
      date.setTime(date.getTime() + (days*24*60*60*1000));
      expires = "; expires=" + date.toUTCString();
    }
    document.cookie = name + "=" + (value || "") + expires + "; path=/";
  }
  
  function getCookie(name) {
    const nameEQ = name + "=";
    const ca = document.cookie.split(';');
    for(let i = 0; i < ca.length; i++) {
      let c = ca[i];
      while (c.charAt(0) === ' ') c = c.substring(1);
      if (c.indexOf(nameEQ) === 0) return c.substring(nameEQ.length);
    }
    return null;
  }
  

/*********************** MAIN FUNCTION: LOAD MARKERS **************************/
function loadMarkers() {
    $.ajax({
    dataType: "json",
    url: "pscs_list_of_non-uk_corp_pscs_v3.5.json", // Using the latest JSON version
    success: function(data) {
        // Loop through each data item (limit based on debug_limit)
        for (let i = 0; i < Math.min(data.length, debug_limit); i++) {
        const item = data[i];
        // Choose coordinates based on the current mode
        let lat, lon;
        if (useUKCompanyLocation && item.company_details && item.company_details.lat && item.company_details.lon) {
            lat = item.company_details.lat;
            lon = item.company_details.lon;
        } else {
            lat = item.latitude;
            lon = item.longitude;
        }
        if (lat == null || lon == null) continue;
        
        // Destructure company details and PSC data
        const company_details = item.company_details || {};
        const psc_data = item.data || {};
        
        // Extract flags and details
        const accounts_overdue = company_details.accounts_overdue || false;
        const registered_office_is_in_dispute = company_details.registered_office_is_in_dispute || false;
        const undeliverable_registered_office_address = company_details.undeliverable_registered_office_address || false;
        const ceased_on = psc_data.ceased_on;
        
        const accounts_type = company_details.accounts_type || "";
        const incorporation_date = company_details.incorporation_date || "";
        const company_status = company_details.company_status || "";
        const SICs = company_details.SICs || "";
        
        // Determine marker color using helper function
        const marker_color = getMarkerColor(company_status, ceased_on, accounts_overdue, registered_office_is_in_dispute, undeliverable_registered_office_address, accounts_type);
        
        // Build company information strings
        const company_number = item.company_number;
        const uk_company_name = company_details.company_name || "Unknown UK Company";
        const uk_url = "https://find-and-update.company-information.service.gov.uk/company/" + company_number;
        const uk_company_html = `<b><a href="${uk_url}" target="_blank">${uk_company_name}</a></b>`;
        
        // Build PSC information string
        // PSC details
        let psc_name = psc_data.name.toUpperCase() || "UNKNOWN PSC";
        
        const psc_url = "https://find-and-update.company-information.service.gov.uk/company/" + company_number + "/persons-with-significant-control";
        let psc_html = `<b><a href="${psc_url}" target="_blank">${psc_name}</a></b>`;

        if (psc_data.ceased_on) {
            psc_html += `<br><span style='font-size:12px;'>(ceased to be PSC on ${psc_data.ceased_on})</span>`;
        }
        

        // Build warnings string (if any)
        const warnings = [];
        if (accounts_overdue) warnings.push("accounts overdue");
        if (registered_office_is_in_dispute) warnings.push("disputed registered office");
        if (undeliverable_registered_office_address) warnings.push("undeliverable registered office");
        const warnings_html = warnings.join("<br>");
        
        
        // Build the PSC address (from PSC data)
        const address_data = psc_data.address || {};
        const address_parts = [];
        ["premises", "address_line_1", "locality", "region", "country"].forEach(key => {
            if (address_data[key]) address_parts.push(address_data[key]);
        });
        const address_text = address_parts.join(", ");
        
        // UK company address in title case (if available)
        const uk_company_address = company_details.address ? toTitleCase(company_details.address) : "";
        
        // Generate the popup HTML using our helper function
        const popup_html = generatePopup(psc_html, address_text, uk_company_html, uk_company_address, incorporation_date, company_status, warnings_html, accounts_type, SICs, company_number);

        
        // Create a custom marker with a divIcon
        const iconHtml = `<div style="background-color:${marker_color}; width:12px; height:12px; border-radius:50%; border:1px solid black;"></div>`;
        const marker = L.marker([lat, lon], {
            title: uk_company_name,
            icon: L.divIcon({ html: iconHtml, className: '' })
        }).bindPopup(popup_html);
        
        // Add custom properties for search and identification
        marker.myId = company_number;
        marker.myCompanyName = uk_company_name.toLowerCase();
        marker.myPSCName = psc_name.toLowerCase();
        marker.category = marker_color;

        // In UK mode, the marker’s position is at the UK company location.
        marker.ukLat = (company_details && company_details.lat) || null;
        marker.ukLon = (company_details && company_details.lon) || null;
        // The PSC coordinates come from the main item (which is used in PSC mode).
        marker.pscLat = item.latitude;
        marker.pscLon = item.longitude;
        
        // Add marker to our tracking arrays and to the appropriate cluster
        markersArray.push(marker);
        markersByCategory[marker_color].push(marker);
        markerClusters[marker_color].addLayer(marker);
        }
    },
    error: function(err) {
        console.error("Error loading JSON data:", err);
    },
    complete: function() {
        // Hide the loading overlay.
        $('#loading-overlay').fadeOut();
    
        // Check for URL parameters.
        const params = new URLSearchParams(window.location.search);
        if (params.has("s") || (params.has("lat") && params.has("lng") && params.has("zoom"))) {
            // If parameters exist, restore them.
            applyUrlParameters();
        } else if (!getCookie("tutorialSeen")) {
            // Otherwise, auto‑start the tutorial.
            if (window.shepherdTour) {
                window.shepherdTour.start();
                setCookie("tutorialSeen", "true", 365); // Set cookie for 1 year
            }
        }
    }
    });
}


/*********************** EVENT LISTENERS **************************/
// Mode toggle radio buttons
document.querySelectorAll('input[name="locationMode"]').forEach(radio => {
    radio.addEventListener("change", function() {
    switchMode(this.value === "uk");
    });
});

// Search input filtering
document.getElementById("searchInput").addEventListener("keyup", function() {
    const searchText = this.value.trim().toLowerCase();
    const resultsDiv = document.getElementById("searchResults");
    resultsDiv.innerHTML = "";
    const activeCategories = [];
    document.querySelectorAll('.legend-item').forEach(item => {
    if (item.getAttribute("data-active") === "true") {
        activeCategories.push(item.getAttribute("data-category"));
    }
    });
    if (searchText === "") return;
    markersArray.forEach(marker => {
    if (activeCategories.indexOf(marker.category) !== -1 &&
        (marker.myCompanyName.indexOf(searchText) !== -1 || marker.myPSCName.indexOf(searchText) !== -1)
    ) {
        const div = document.createElement("div");
        div.className = "result-item";
        div.innerHTML = marker.options.title;
        div.addEventListener("click", () => {
        markerClusters[marker.category].zoomToShowLayer(marker, () => {
            marker.openPopup();
        });
        });
        resultsDiv.appendChild(div);
    }
    });
});

// Legend toggling for layers
document.querySelectorAll('.legend-item').forEach(item => {
    item.addEventListener("click", function() {
    const cat = this.getAttribute("data-category");
    const active = this.getAttribute("data-active") === "true";
    if (active) {
        map.removeLayer(markerClusters[cat]);
        this.setAttribute("data-active", "false");
        this.classList.add("inactive");
        this.querySelector(".legend-box").classList.add("inactive");
    } else {
        map.addLayer(markerClusters[cat]);
        this.setAttribute("data-active", "true");
        this.classList.remove("inactive");
        this.querySelector(".legend-box").classList.remove("inactive");
    }
    });
});


// Share view functionality (copy URL with current map state)
window.addEventListener("load", function() {
    document.getElementById("shareViewButton").addEventListener("click", function() {
        const center = map.getCenter();
        const zoom = map.getZoom();
        
        // If more than 25 links exist, show a non-modal warning.
        if (linkedPSCIds.length > 25) {
          const warning = document.createElement("div");
          warning.innerText = `Of the ${linkedPSCIds.length} links created, only the first 25 can be shared.`;
          Object.assign(warning.style, {
            position: "fixed",
            top: "10px",
            right: "10px",
            backgroundColor: "yellow",
            padding: "10px",
            zIndex: "1500",
            border: "1px solid #ccc",
            borderRadius: "4px",
            boxShadow: "0px 0px 5px rgba(0,0,0,0.5)"
          });
          document.body.appendChild(warning);
          setTimeout(() => {
            document.body.removeChild(warning);
          }, 3000);
        }
        
        // Build a state object including only the first 25 links.
        const state = {
          lat: center.lat.toFixed(6),
          lng: center.lng.toFixed(6),
          zoom: zoom,
          popup: activeMarker && activeMarker.myId,
          links: linkedPSCIds.slice(0, 25),
          layers: {
            green: map.hasLayer(markerClusters.green),
            orange: map.hasLayer(markerClusters.orange),
            red: map.hasLayer(markerClusters.red),
            grey: map.hasLayer(markerClusters.grey),
            black: map.hasLayer(markerClusters.black)
          }
        };
        
        // JSON encode and compress the state.
        const jsonState = JSON.stringify(state);
        const compressedState = LZString.compressToEncodedURIComponent(jsonState);
        
        // Build the share URL with the compressed state in a single parameter "s".
        const shareUrl = window.location.protocol + "//" + window.location.host + window.location.pathname + "?s=" + compressedState;
        const shareUrlInput = document.getElementById("shareUrlInput");
        shareUrlInput.value = shareUrl;
        document.getElementById("shareUrlContainer").style.display = "block";
      });
      
      
      
    
    document.getElementById("copyShareUrlButton").addEventListener("click", function() {
        const shareUrlInput = document.getElementById("shareUrlInput");
        shareUrlInput.select();
        shareUrlInput.setSelectionRange(0, 99999);
        navigator.clipboard.writeText(shareUrlInput.value).then(() => {
            const notification = document.createElement("div");
            notification.innerText = "URL copied to clipboard!";
            Object.assign(notification.style, {
            position: "fixed",
            right: "10px",
            top: "70%",
            backgroundColor: "lightgreen",
            padding: "10px",
            zIndex: "1500",
            borderRadius: "4px"
            });
            document.body.appendChild(notification);
            document.getElementById("shareUrlContainer").style.display = "none";
            setTimeout(() => { document.body.removeChild(notification); }, 2000);
        }, () => {
            const notification = document.createElement("div");
            notification.innerText = "Failed to copy URL.";
            Object.assign(notification.style, {
            position: "fixed",
            right: "10px",
            top: "70%",
            backgroundColor: "salmon",
            padding: "10px",
            zIndex: "1500",
            borderRadius: "4px"
            });
            document.body.appendChild(notification);
            setTimeout(() => { document.body.removeChild(notification); }, 2000);
        });
    });
});

// Initially load markers (in default PSC mode)
loadMarkers();

// Searching for places
// Listen for the Enter key on the places search input.
$('#placeSearchInput').on('keypress', function(e) {
    if (e.which === 13) { // Enter key
    e.preventDefault();
    const searchText = $(this).val().trim();
    const resultsDiv = $('#placeSearchResults');
    resultsDiv.empty();
    
    if (searchText === '') return;
    
    // Make a JSONP request to Nominatim.
    $.ajax({
        url: "https://nominatim.openstreetmap.org/search",
        dataType: "jsonp",            // Use JSONP to bypass CORS
        jsonp: "json_callback",       // The parameter that tells Nominatim to return JSONP
        data: {
        q: searchText,
        format: "json",
        limit: 5,
        addressdetails: 1
        },
        success: function(results) {
        if (!results || results.length === 0) {
            resultsDiv.append($('<div class="result-item"></div>').text('No results found.'));
            return;
        }
        
        // Create a dropdown list of results.
        results.forEach(function(result) {
            const resultItem = $('<div class="result-item"></div>').text(result.display_name);
            
            // When a result is clicked, pan/zoom the map to that location.
            resultItem.on('click', function() {
            map.setView([result.lat, result.lon], 10); // Adjust zoom level as needed
            resultsDiv.empty();
            $('#placeSearchInput').val(result.display_name);
            });
            
            resultsDiv.append(resultItem);
        });
        },
        error: function(xhr, status, error) {
        resultsDiv.append($('<div class="result-item"></div>').text('Error retrieving geocoder results.'));
        console.error("Geocoding error:", status, error);
        }
    });
    }
});

// draws the link line
$(document).on("click", ".show-link", function() {
    const companyId = $(this).data("company");
    const marker = findMarkerById(companyId);
    if (!marker) {
      console.warn("No marker found for company ID:", companyId);
      return;
    }
    // Only add if not already linked (avoid duplicates)
    if (linkedPSCIds.indexOf(companyId) === -1) {
      linkedPSCIds.push(companyId);
    }
    drawLinkForMarker(marker);
    
    // Show the "Clear Links" button if not already visible.
    $("#clearLinksButton").show();
    
    // Zoom so the entire link is visible.
    const latestLink = linkLayers[linkLayers.length - 1];
    if (latestLink) {
      map.fitBounds(latestLink.getBounds());
    }
  });
  
  // clear links button
  $(document).on("click", "#clearLinksButton", function() {
    // Remove all polylines.
    linkLayers.forEach(function(link) {
      map.removeLayer(link);
    });
    linkLayers = [];
    
    // Remove all extra (giant) markers.
    giantMarkers.forEach(function(marker) {
      map.removeLayer(marker);
    });
    giantMarkers = [];
    
    // Reset all markers to their small icon.
    markersArray.forEach(function(marker) {
      const smallIcon = L.divIcon({
        html: `<div style="background-color:${marker.category}; width:12px; height:12px; border-radius:50%; border:1px solid black;"></div>`,
        className: ''
      });
      marker.setIcon(smallIcon);
    });
    
    // Clear the linked IDs list.
    linkedPSCIds = [];
    
    // Hide the Clear Links button.
    $(this).hide();
  });
  
  
// When the button is clicked, enable drawing mode.
$(document).on("click", "#selectAreaButton", function() {
    // Create a new Draw Control with only the rectangle enabled.
    let drawControl = new L.Control.Draw({
      draw: {
        polyline: false,
        polygon: false,
        circle: false,
        marker: false,
        circlemarker: false,
        rectangle: {
          shapeOptions: {
            color: 'blue'
          }
        }
      },
      edit: {
        featureGroup: new L.FeatureGroup() // Required by the plugin.
      }
    });
  
    // Add the control to the map.
    map.addControl(drawControl);
  
    // Activate the rectangle drawing tool.
    new L.Draw.Rectangle(map, drawControl.options.draw.rectangle).enable();
  
    // Once a rectangle is drawn, handle selection.
    map.once(L.Draw.Event.CREATED, function(e) {
      // Remove the draw control from the map.
      map.removeControl(drawControl);
  
      drawnLayer = e.layer;
      // Add the rectangle to the map (optional: you might want to remove it later).
      drawnLayer.addTo(map);
  
      // Get the bounds of the drawn rectangle.
      const bounds = drawnLayer.getBounds();
  
      // Determine active categories (visible markers)
      const activeCategories = [];
      document.querySelectorAll('.legend-item').forEach(item => {
        if (item.getAttribute("data-active") === "true") {
          activeCategories.push(item.getAttribute("data-category"));
        }
      });
  
      // Only select markers that are both visible (active) and within the drawn bounds.
      const selectedMarkers = markersArray.filter(marker =>
        activeCategories.includes(marker.category) && bounds.contains(marker.getLatLng())
      );
  
      // Remove the drawn selection rectangle immediately.
      map.removeLayer(drawnLayer);
      drawnLayer = null;
  
      // Create the message to display count of selected markers.
      let message = `${selectedMarkers.length} companies selected`;
  
      // If count exceeds 100, add a warning message.
      if (selectedMarkers.length > 100) {
        message += ' - too many to display links (max is 100)';
      }
  
      const warning = document.createElement("div");
      warning.innerText = message;
  
      Object.assign(warning.style, {
        position: "fixed",
        top: "10px",
        right: "10px",
        backgroundColor: "yellow",
        padding: "10px",
        zIndex: "1500",
        border: "1px solid #ccc",
        borderRadius: "4px",
        boxShadow: "0px 0px 5px rgba(0,0,0,0.5)"
      });
  
      document.body.appendChild(warning);
      setTimeout(() => {
        document.body.removeChild(warning);
      }, 3000);
  
      // If the count exceeds 100, exit without processing markers.
      if (selectedMarkers.length > 100) {
        return;
      }
  
      // For each selected marker, draw a link using the helper function.
      selectedMarkers.forEach(marker => {
        // Ensure marker has valid coordinates.
        if (marker.ukLat && marker.ukLon && marker.pscLat && marker.pscLon) {
          // Only add if not already linked.
          if (linkedPSCIds.indexOf(marker.myId) === -1) {
            linkedPSCIds.push(marker.myId);
          }
          drawLinkForMarker(marker);
        }
      });
  
      // After processing, adjust the map view to show all drawn links.
      let allBounds = L.latLngBounds([]);
      linkLayers.forEach(link => {
        allBounds.extend(link.getBounds());
      });
      if (allBounds.isValid()) {
        map.fitBounds(allBounds);
      }
  
      // Show the "Clear Links" button if not already visible.
      $("#clearLinksButton").show();
    });
  });
  
  
  
  // Toggle legend minimized state
  document.getElementById('legendToggle').addEventListener('click', function() {
    const legendBox = document.getElementById('legendBox');
    if (legendBox.classList.contains('minimized')) {
      legendBox.classList.remove('minimized');
      this.textContent = '–';
    } else {
      legendBox.classList.add('minimized');
      this.textContent = '+';
    }
  });
  
  
// we create the tutorial instance immediately
document.addEventListener("DOMContentLoaded", function() {

    // also Update the footer with the version number.
    document.getElementById("footerVersion").innerHTML =
      `© Tax Policy Associates, 2025, ${APP_VERSION}`;
    
    const tour = new Shepherd.Tour({
      defaultStepOptions: {
        classes: 'shepherd-theme-arrows',
        scrollTo: true,
        when: {
          show() {
            const currentStep = Shepherd.activeTour?.getCurrentStep();
            const currentStepElement = currentStep?.getElement();
            const footer = currentStepElement?.querySelector('.shepherd-footer');
            const progress = document.createElement('span');
            progress.className = 'shepherd-progress';
            progress.innerText = `${Shepherd.activeTour?.steps.indexOf(currentStep) + 1} of ${Shepherd.activeTour?.steps.length}`;
            footer?.insertBefore(progress, currentStepElement.querySelector('.shepherd-button:last-child'));
          }
        }
      },
      useModalOverlay: true
    });
    
    // Step 1: Welcome
    tour.addStep({
        id: 'step-1',
        text: "<strong>Welcome!</strong><br><br>This map shows the locations of foreign companies registered as PSCs of UK companies. In many cases, this hides the true controlling individuals.",
        buttons: [{
        text: 'Skip',
        action: tour.cancel, 
        classes: 'shepherd-button-secondary'
        },
        { text: 'Next', action: tour.next }]
    });


    // Step 1b: Zoom in on the marker for company 10433360
    tour.addStep({
        id: 'step-zoom',
        text: "Each dot represents a PSC - a foreign company that's (probably wrong) reported as the owner of a UK company. Here's one:",
        classes: 'shepherd-offset-down',
        when: {
        show: function() {
            const marker = findMarkerById("10433360");
            if (marker) {
            // Zoom in to make sure the marker is visible.
            markerClusters[marker.category].zoomToShowLayer(marker, function() {
                // Optional: perform additional actions once zooming is complete.
            });
            }
        }
        },
        buttons: [
        { text: 'Skip', action: tour.cancel },
        { text: 'Next', action: tour.next }
        ]
    });
    
    // Step 2: Click the marker to open its popup
    tour.addStep({
        id: 'step-popup',
        text: "Now, click the marker to open its popup with company details.",
        classes: 'shepherd-offset-down',
        when: {
        show: function() {
            const marker = findMarkerById("10433360");
            if (marker) {
            // This simulates clicking the marker to open its popup.
            marker.openPopup();
            }
        }
        },
        buttons: [
        { text: 'Skip', action: tour.cancel, classes: 'shepherd-button-secondary' },
        { text: 'Back', action: tour.back },
        { text: 'Next', action: tour.next }
        ]
    });
        
    // Step 3: Show Link button
    tour.addStep({
        id: 'step-3',
        text: "You can click the 'Show Link' button to reveal the connection between that PSC and its UK company.",
        attachTo: { element: '#map', on: 'top' },
        buttons: [
        {
        text: 'Skip',
        action: tour.cancel, 
        classes: 'shepherd-button-secondary'
    },
    { text: 'Back', action: tour.back },
        { text: 'Next', action: tour.next }
        ]
    });

    // Step 3b: Show Clear Link button
    tour.addStep({
        id: 'step-3b',
        text: "You can then delete all the visible connections/links by pressing the 'Clear links' button",
        beforeShowPromise: showHamburger,
        attachTo: { element: '#clearLinksButton', on: 'top' },
        buttons: [
            {
        text: 'Skip',
        action: tour.cancel, 
        classes: 'shepherd-button-secondary'
        },
        { text: 'Back', action: tour.back },
            { text: 'Next', action: tour.next }
        ]
        });

    // Step 4: Legend explanation
    tour.addStep({
        id: 'step-4',
        text: "A company/PSC's dot indicates its status. This legend explains the color coding. Red are particularly interesting.",
        attachTo: { element: '#legendBox', on: 'top' },
        buttons: [
        {
        text: 'Skip',
        action: tour.cancel, 
        classes: 'shepherd-button-secondary'
    },
    { text: 'Back', action: tour.back },
        { text: 'Next', action: tour.next }
        ]
    });

    // Step 5: Legend interactivity
    tour.addStep({
        id: 'step-5',
        text: "Click on any legend item to toggle the visibility of that type of PSC. By default, dissolved companies and former PSCs are hidden. You can, for instance, show only companies in default (red) to spot suspicious cases.",
        attachTo: { element: '.legend-item[data-category="red"]', on: 'right' },
        buttons: [
        {
        text: 'Skip',
        action: tour.cancel, 
        classes: 'shepherd-button-secondary'
    },
    { text: 'Back', action: tour.back },
        { text: 'Next', action: tour.next }
        ]
    });

    // Step 6: Company search
    tour.addStep({
        id: 'step-6',
        text: "You can search for companies/PSCs by entering their name here - a list of matching companies appears. Click on one to jump to it.",
        attachTo: { element: '#companySearchContainer', on: 'bottom' },
        buttons: [
        {
        text: 'Skip',
        action: tour.cancel, 
        classes: 'shepherd-button-secondary'
    },
    { text: 'Back', action: tour.back },
        { text: 'Next', action: tour.next }
        ]
    });

    // Step 7: Place search
    tour.addStep({
        id: 'step-7',
        text: "Use this search box to look up companies by country or location. For instance, search for 'Fiji' to jump to that area on the map.",
        attachTo: { element: '#placeSearchContainer', on: 'left' },
        buttons: [
        {
        text: 'Skip',
        action: tour.cancel, 
        classes: 'shepherd-button-secondary'
    },
    { text: 'Back', action: tour.back },
        { text: 'Next', action: tour.next }
        ]
    });

    // Step 8: Draw Selection
    tour.addStep({
        id: 'step-8',
        text: "Click 'Draw Selection' to select multiple companies at once. It will count all the companies in your selection and display links for each of them.",
        attachTo: { element: '#selectAreaButton', on: 'left' },
        buttons: [
        {
        text: 'Skip',
        action: tour.cancel, 
        classes: 'shepherd-button-secondary'
    },
    { text: 'Back', action: tour.back },
        { text: 'Next', action: tour.next }
        ]
    });

    // Step 9: Mode toggle
    tour.addStep({
        id: 'step-9',
        text: "The map starts by showing the foreign PSCs. But you can toggle this control and instead show the UK companies they control.",
        when: {
        hide: dismissHamburger
        },
        attachTo: { element: '#modeToggleContainer', on: 'top' },
        buttons: [
        {
        text: 'Skip',
        action: tour.cancel, 
        classes: 'shepherd-button-secondary'
    },
    { text: 'Back', action: tour.back },
        { text: 'Next', action: tour.next }
        ]
    });

    // Step 10: Share View
    tour.addStep({
        id: 'step-10',
        text: "If you find something interesting, click 'Share View' to create a link that captures your current map view and selections. You can then copy and share it.",
        attachTo: { element: '#shareViewButton', on: 'left' },
        buttons: [
        {
        text: 'Skip',
        action: tour.cancel, 
        classes: 'shepherd-button-secondary'
    },
    { text: 'Back', action: tour.back },
        { text: 'Next', action: tour.next }
        ]
    });

    // Step 11: Additional details
    tour.addStep({
        id: 'step-11',
        text: `Full details in <a href="https://taxpolicy.org.uk/65000-uk-companies-fail-to-declare-their-beneficial-owner" target="_blank" rel="noopener noreferrer">our article</a>.<br><br>Please note the caveats and limitations.<br>Make no assumptions about the status of any company without manually reviewing its Companies House entry.`,
        buttons: [
        {
        text: 'Skip',
        action: tour.cancel, 
        classes: 'shepherd-button-secondary'
    },
    { text: 'Back', action: tour.back },
        { text: 'Next', action: tour.next }
        ]
    });

    // Step 12: Re-run tutorial information
    tour.addStep({
        id: 'step-12',
        text: "You can re-run this tutorial at any time.<br><br>If you have an iPhone, you can 'save to desktop' and the map will behave like an app.",
        attachTo: { element: '#reRunTutorialButton', on: 'left' },
        buttons: [
        {
        text: 'Skip',
        action: tour.cancel, 
        classes: 'shepherd-button-secondary'
    },
    { text: 'Back', action: tour.back },
        { text: 'Done', action: tour.complete }
        ]
    });
  
    // Save the tutorial instance globally so it can be restarted later.
    window.shepherdTour = tour;
  });

  
//Hamburger scripts
function updateControlsPlacement() {
    const mapControls = document.getElementById('mapControls');
    const mobileContainer = document.getElementById('mobileControlsContainer');
    const legend = document.getElementById('legendBox');
    const isMobile = window.matchMedia('(max-width: 767px)').matches || window.matchMedia('(pointer: coarse) and (hover: none)').matches;
    
    if (isMobile) {
      if (mapControls.parentElement !== mobileContainer) {
        mobileContainer.appendChild(mapControls);
        // Remove fixed positioning for mobile
        mapControls.style.position = 'static';
        mapControls.style.right = 'auto';
        mapControls.style.top = 'auto';
      }
      // Insert the legend at the top of the offcanvas container.
      if (legend.parentElement !== mobileContainer) {
        mobileContainer.insertBefore(legend, mobileContainer.firstChild);
      }
    } else {
      if (mapControls.parentElement !== document.body) {
        document.body.appendChild(mapControls);
        mapControls.style.position = 'fixed';
        mapControls.style.right = '10px';
        mapControls.style.top = '35%';
      }
      if (legend.parentElement !== document.body) {
        document.body.appendChild(legend);
      }
    }
    
    // Optionally, schedule multiple invalidateSize calls
    scheduleInvalidateSize();
  }
  

  // Run on load, resize, and orientation change
  updateControlsPlacement();
  window.addEventListener('resize', updateControlsPlacement);
  window.addEventListener('orientationchange', updateControlsPlacement);
  scheduleInvalidateSize();

  // Function to dismiss the offcanvas (hamburger menu)
  function dismissHamburger() {
    var offcanvasEl = document.getElementById('mobileControlsOffcanvas');
    var bsOffcanvas = bootstrap.Offcanvas.getInstance(offcanvasEl);
    if (bsOffcanvas) {
      bsOffcanvas.hide();
    }
  }
  
  // Attach offcanvas action listeners once everything is fully loaded
  window.addEventListener('load', function() {
    var offcanvas = document.getElementById('mobileControlsOffcanvas');
    // When offcanvas is hidden, force the map to redraw its size.
    offcanvas.addEventListener('hidden.bs.offcanvas', function() {
      if (typeof map !== 'undefined' && map.invalidateSize) {
        map.invalidateSize();
      }
    });
    // Dismiss offcanvas on specified actions, but ignore clicks inside the legend.
    offcanvas.addEventListener('click', function(e) {
      if (e.target.closest('#legendBox')) {
        // Do not dismiss if clicking within the legend.
        return;
      }
      if (
        e.target.matches('#reRunTutorialButton, #selectAreaButton, #shareViewButton, #clearLinksButton') ||
        e.target.closest('#modeToggleContainer input') ||
        e.target.closest('#searchResults .result-item') ||
        e.target.closest('#placeSearchResults .result-item')
      ) {
        setTimeout(dismissHamburger, 100);
      }
      scheduleInvalidateSize();
    });
  });
  
  // Clear search results when a result is clicked.
  document.getElementById("searchInput").addEventListener("keyup", function() {
    const searchText = this.value.trim().toLowerCase();
    const resultsDiv = document.getElementById("searchResults");
    resultsDiv.innerHTML = "";
    const activeCategories = [];
    document.querySelectorAll('.legend-item').forEach(item => {
      if (item.getAttribute("data-active") === "true") {
        activeCategories.push(item.getAttribute("data-category"));
      }
    });
    if (searchText === "") return;
    markersArray.forEach(marker => {
      if (activeCategories.indexOf(marker.category) !== -1 &&
          (marker.myCompanyName.indexOf(searchText) !== -1 || marker.myPSCName.indexOf(searchText) !== -1)
      ) {
        const div = document.createElement("div");
        div.className = "result-item";
        div.innerHTML = marker.options.title;
        div.addEventListener("click", () => {
          markerClusters[marker.category].zoomToShowLayer(marker, () => {
            marker.openPopup();
            // Clear company search results when a result is clicked.
            document.getElementById("searchResults").innerHTML = "";
          });
        });
        resultsDiv.appendChild(div);
      }
    });
  });
  
  // Also clear search results if clicking outside the search containers.
  document.addEventListener('click', function(e) {
    if (!e.target.closest('#companySearchContainer')) {
      document.getElementById('searchResults').innerHTML = '';
    }
    if (!e.target.closest('#placeSearchContainer')) {
      document.getElementById('placeSearchResults').innerHTML = '';
    }
  });


  window.addEventListener('load', function() {
    scheduleInvalidateSize();
});
  
