const ORS_KEY = import.meta.env.VITE_OPENROUTE_KEY
const TT_APP_ID = import.meta.env.VITE_TRAVELTIME_APP_ID
const TT_API_KEY = import.meta.env.VITE_TRAVELTIME_API_KEY

/** Greater Boston-ish bounding box for Photon (minLon,minLat,maxLon,maxLat) */
const PHOTON_BBOX = '-71.55,42.15,-70.85,42.55'

function formatPhotonLabel(props) {
  const streetLine = [props.housenumber, props.street].filter(Boolean).join(' ').trim()
  const place = [props.city || props.town || props.district, props.state].filter(Boolean).join(', ')
  if (streetLine && place) return `${streetLine}, ${place}`
  if (props.name && place) return `${props.name}, ${place}`
  if (props.name) return props.name
  if (place) return place
  return 'Selected location'
}

function photonFeaturesToSuggestions(features) {
  return features.map((f) => {
    const [lng, lat] = f.geometry.coordinates
    return {
      label: formatPhotonLabel(f.properties || {}),
      lat,
      lng,
    }
  })
}

/**
 * Photon (OSM) — works from the browser without an API key. Used when OpenRoute is unavailable.
 */
async function photonAutocomplete(text) {
  const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(text)}&limit=8&bbox=${PHOTON_BBOX}`
  const res = await fetch(url)
  if (!res.ok) return []
  const data = await res.json()
  const features = data.features || []
  return photonFeaturesToSuggestions(features)
}

async function photonGeocode(query) {
  const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=1&bbox=${PHOTON_BBOX}`
  const res = await fetch(url)
  if (!res.ok) throw new Error('Photon geocode failed')
  const data = await res.json()
  const f = data.features?.[0]
  if (!f) throw new Error('Could not geocode address')
  const [lng, lat] = f.geometry.coordinates
  return { lat, lng }
}

export async function autocompleteAddress(text) {
  const q = text.trim()
  if (!q) return []

  if (ORS_KEY) {
    try {
      const url = `https://api.openrouteservice.org/geocode/autocomplete?api_key=${ORS_KEY}&text=${encodeURIComponent(q)}&boundary.country=US&boundary.rect.min_lon=-71.5&boundary.rect.min_lat=42.0&boundary.rect.max_lon=-70.8&boundary.rect.max_lat=42.7&size=8`
      const res = await fetch(url)
      if (res.ok) {
        const data = await res.json()
        if (data.features?.length) {
          return data.features.map((f) => ({
            label: f.properties.label,
            lat: f.geometry.coordinates[1],
            lng: f.geometry.coordinates[0],
          }))
        }
      }
    } catch {
      /* fall through to Photon */
    }
  }

  return photonAutocomplete(q)
}

export async function geocodeAddress(address) {
  const q = address.trim()
  if (!q) throw new Error('Could not geocode address')

  if (ORS_KEY) {
    try {
      const url = `https://api.openrouteservice.org/geocode/search?api_key=${ORS_KEY}&text=${encodeURIComponent(q)}&boundary.country=US&size=1`
      const res = await fetch(url)
      if (res.ok) {
        const data = await res.json()
        if (data.features?.length) {
          const [lng, lat] = data.features[0].geometry.coordinates
          return { lat, lng }
        }
      }
    } catch {
      /* fall through */
    }
  }

  return photonGeocode(q)
}

export async function fetchIsochrone(lat, lng, mode, intervals = [600, 1200, 1800]) {
  if (mode === 'public_transport') {
    return fetchTransitIsochrone(lat, lng, intervals)
  }
  const profile = mode === 'foot-walking' ? 'foot-walking' : 'driving-car'
  const url = `https://api.openrouteservice.org/v2/isochrones/${profile}`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': ORS_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      locations: [[lng, lat]],
      range: intervals,
      range_type: 'time',
    }),
  })
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Isochrone API error: ${err}`)
  }
  return res.json()
}

async function fetchTransitIsochrone(lat, lng, intervals) {
  const departureTime = new Date()
  departureTime.setHours(8, 0, 0, 0)
  if (departureTime < new Date()) {
    departureTime.setDate(departureTime.getDate() + 1)
  }

  const res = await fetch('https://api.traveltimeapp.com/v4/time-map', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Application-Id': TT_APP_ID,
      'X-Api-Key': TT_API_KEY,
    },
    body: JSON.stringify({
      departure_searches: intervals.map((seconds, i) => ({
        id: `iso_${seconds}`,
        coords: { lat, lng },
        departure_time: departureTime.toISOString(),
        travel_time: seconds,
        transportation: { type: 'public_transport' },
      })),
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    console.warn('TravelTime API error, falling back to walking isochrone:', err)
    return fetchIsochrone(lat, lng, 'foot-walking', intervals)
  }

  const data = await res.json()
  const features = data.results.map((result) => {
    const shells = result.shapes.map((shape) => {
      const ring = shape.shell.map((p) => [p.lng, p.lat])
      ring.push(ring[0])
      const holes = (shape.holes || []).map((hole) => {
        const h = hole.map((p) => [p.lng, p.lat])
        h.push(h[0])
        return h
      })
      return [ring, ...holes]
    })
    const seconds = parseInt(result.search_id.split('_')[1])
    return {
      type: 'Feature',
      properties: { value: seconds, center: [lng, lat] },
      geometry: {
        type: shells.length === 1 ? 'Polygon' : 'MultiPolygon',
        coordinates: shells.length === 1 ? shells[0] : shells,
      },
    }
  })

  return {
    type: 'FeatureCollection',
    features: features.sort((a, b) => b.properties.value - a.properties.value),
  }
}

export async function fetchDirections(fromLat, fromLng, toLat, toLng, profile = 'foot-walking') {
  const url = `https://api.openrouteservice.org/v2/directions/${profile}?api_key=${ORS_KEY}&start=${fromLng},${fromLat}&end=${toLng},${toLat}`
  const res = await fetch(url)
  if (!res.ok) throw new Error('Directions API error')
  return res.json()
}

export async function fetchCensusRentData() {
  const url = 'https://api.census.gov/data/2023/acs/acs5/profile?get=GEO_ID,DP04_0134E,DP04_0126E,DP04_0127E,DP04_0128E,DP04_0129E,DP04_0130E,DP04_0131E,DP04_0132E,DP04_0133E&for=tract:*&in=state:25'
  const res = await fetch(url)
  if (!res.ok) throw new Error('Census API error')
  const data = await res.json()
  const headers = data[0]
  return data.slice(1).map((row) => {
    const obj = {}
    headers.forEach((h, i) => { obj[h] = row[i] })
    return obj
  })
}

export async function fetchTractBoundaries() {
  // Load pre-downloaded tract boundaries for Greater Boston area
  const res = await fetch(import.meta.env.BASE_URL + 'data/boston_tracts.geojson')
  if (!res.ok) throw new Error('Failed to load tract boundaries')
  return res.json()
}
