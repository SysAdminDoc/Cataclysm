# Preset Scenarios

Each preset represents a historical or hypothetical tsunami event with parameters drawn from peer-reviewed literature. Presets marked with a warning icon (speculative) have disputed or uncertain source parameters.

## Search NOAA historical records

Installed desktop builds add **Search NOAA historical events** to the scenario
library toolbar. Enter a year, location, or both—for example, `1960 Chile`—to
query the NOAA/NCEI Global Historical Tsunami Database through HazEL. The
lookup requires a network connection; the built-in scenario library remains
available if the service or connection is unavailable. Browser previews
deliberately make no HazEL request.

For earthquake-generated records that include a supported magnitude and
epicentre, **Load into builder** copies only those observed catalog fields into
the Earthquake tab. Cataclysm's default fault geometry, slip, hypocentre depth,
and water depth remain in place and must be reviewed before simulation. The
builder shows the HazEL event ID, database DOI (`10.7289/V5PN93H7`), imported
values, and the historical-database uncertainty warning. Non-earthquake and
incomplete records remain visible but cannot be translated into an earthquake
source.

## Historical events

### Chicxulub impact (66 Ma)

The asteroid impact that ended the Cretaceous period. A ~14 km diameter asteroid struck the Yucatan Peninsula, generating a global mega-tsunami with initial wave heights exceeding 4.5 km.

- **Source**: Range et al. 2022, *AGU Advances*
- **Parameters**: 14 km dia, 3000 kg/m³, 20 km/s, 60° impact angle
- **Peak wave**: ~4.5 km initial, ~1.5 km at 220 km range

### Tōhoku 2011 (M 9.1)

The Great East Japan Earthquake generated a devastating tsunami that killed over 18,000 people. The Okada fault model produces an initial seafloor displacement of 5–10 m over a 450 km rupture zone.

- **Source**: Mori et al. 2011; Fujii & Satake 2013
- **Parameters**: M 9.1, strike 195°, dip 12°, rake 85°, slip 15 m
- **Peak runup**: ~40 m measured at Miyako

### Indian Ocean 2004 (M 9.2)

The Boxing Day earthquake off Sumatra generated a trans-oceanic tsunami affecting 14 countries and killing ~230,000 people.

- **Source**: Synolakis et al. 2005; Lay et al. 2005
- **Parameters**: M 9.2, 1300 km rupture, 20 m slip
- **Peak runup**: ~30 m in Banda Aceh

### Lituya Bay 1958

A rockslide-generated mega-tsunami in Lituya Bay, Alaska. The world's tallest recorded tsunami wave at 524 m runup on the opposite shore of the fjord.

- **Source**: Fritz et al. 2001
- **Parameters**: 30 million m³ rockslide, 700 m drop, confined fjord geometry
- **Peak runup**: 524 m (measured trimline)

### Krakatoa 1883

The volcanic caldera collapse generated tsunamis up to 42 m that killed ~36,000 people in the Sunda Strait.

- **Source**: Choi et al. 2003; Maeno & Imamura 2011
- **Note**: Uses a nuclear burst proxy; a dedicated volcanic caldera collapse source model is a future goal

### Storegga slide (~8150 BP)

A massive submarine landslide off the Norwegian coast generated tsunamis across the North Atlantic, with 20+ m deposits found in Scotland.

- **Source**: Bondevik et al. 2005
- **Parameters**: ~3000 km³ slide volume

### Hunga Tonga 2022

The submarine volcanic eruption generated both ocean waves and an atmospheric Lamb wave that circled the globe, causing far-field tsunamis via Proudman resonance.

- **Source**: Carvajal et al. 2022; Kubota et al. 2022
- **Note**: The Lamb-wave coupling is partially modeled; full atmospheric coupling is a research frontier

## Hypothetical/speculative events

### Eltanin impact (2.51 Ma)

A ~1 km asteroid impact in the South Pacific. Geological evidence (iridium layer, disturbed deep-sea sediments) confirms the impact; the tsunami was globally significant.

- **Source**: Gersonde et al. 1997

### Cumbre Vieja flank collapse

A hypothetical mega-tsunami from the lateral collapse of La Palma's Cumbre Vieja volcano. The wave heights are heavily disputed — Ward & Day 2001 predicted 5–25 m on the US East Coast, but later work by Abadie et al. 2012 and others suggests much smaller waves.

- **Source**: Ward & Day 2001 (controversial)
- **Note**: Marked speculative due to the ongoing scientific dispute

### Poseidon deployment

A hypothetical scenario modeling the claimed capabilities of Russia's Status-6/Poseidon nuclear torpedo. The DNA 1996 study puts underwater-explosion wave efficiency at ~5%, producing waves of 1–5 m at 100 km — far below Russian state media's 500 m claim. Both the propaganda yield and a realistic estimate are modeled.

- **Source**: DNA 1996; Glasstone 1977
- **Note**: Marked speculative; the comparison between propaganda and realistic physics is the point
