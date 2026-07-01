export type GlossaryEntry = {
  term: string;
  definition: string;
  citation?: string;
};

const GLOSSARY: Record<string, GlossaryEntry> = {
  mw: {
    term: "Mw (Moment Magnitude)",
    definition:
      "A logarithmic scale measuring total seismic energy released by an earthquake. Each integer step represents ~32× more energy.",
    citation: "Kanamori 1977; Hanks & Kanamori 1979",
  },
  swe: {
    term: "SWE (Shallow-Water Equations)",
    definition:
      "Depth-averaged 2D fluid equations that model long-wave propagation. Valid when wavelength >> water depth.",
    citation: "de Saint-Venant 1871",
  },
  okada: {
    term: "Okada Model",
    definition:
      "Analytical solution for surface deformation from a rectangular fault in an elastic half-space. Used to compute seafloor uplift from earthquake parameters.",
    citation: "Okada 1985, BSSA 75:1135–1154",
  },
  synolakis: {
    term: "Synolakis Runup Law",
    definition:
      "Analytical formula relating offshore wave amplitude and beach slope to maximum vertical runup height on a planar beach.",
    citation: "Synolakis 1987, J. Fluid Mech. 185:523–545",
  },
  dart: {
    term: "DART (Deep-ocean Assessment and Reporting of Tsunamis)",
    definition:
      "NOAA's network of seafloor pressure sensors that detect tsunami waves in the open ocean with millimeter precision.",
    citation: "NOAA PMEL",
  },
  cfl: {
    term: "CFL (Courant–Friedrichs–Lewy) Condition",
    definition:
      "Stability criterion requiring that the numerical time step is small enough that information cannot travel more than one grid cell per step.",
    citation: "Courant, Friedrichs & Lewy 1928",
  },
  runup: {
    term: "Runup",
    definition:
      "Maximum vertical elevation above sea level reached by a tsunami wave on shore. Measured from still-water level to the highest point of wave contact.",
  },
  eta: {
    term: "η (Eta, Surface Elevation)",
    definition:
      "Water surface displacement above or below the undisturbed sea level. Positive η means the surface is elevated; negative means it is depressed.",
  },
  cavity_radius: {
    term: "Cavity Radius",
    definition:
      "Radius of the transient water crater formed by an impact or explosion. Determines the initial wave amplitude and wavelength.",
    citation: "Ward & Asphaug 2000",
  },
  attenuation: {
    term: "Attenuation",
    definition:
      "Decrease in wave amplitude with distance from the source due to geometric spreading and energy dissipation. Typically follows r^(-5/6) in deep water.",
  },
  boussinesq: {
    term: "Boussinesq Equations",
    definition:
      "Extension of SWE that includes frequency dispersion, allowing shorter waves to travel at different speeds. Important for impact-generated waves.",
    citation: "Boussinesq 1872; Peregrine 1967",
  },
  manning: {
    term: "Manning Friction",
    definition:
      "Empirical bottom-friction model using a roughness coefficient n. Higher n (rougher seabed) causes faster wave energy loss near the coast.",
    citation: "Manning 1891",
  },
  leapfrog: {
    term: "Leapfrog Scheme",
    definition:
      "Numerical time-stepping method that alternates between updating velocities and elevations on a staggered grid. Second-order accurate, non-dissipative.",
  },
  wavefront: {
    term: "Wavefront",
    definition:
      "The leading edge of an expanding tsunami wave. In deep water it travels at √(g·h), roughly 200 m/s (720 km/h) over a 4 km ocean.",
  },
  inundation: {
    term: "Inundation",
    definition:
      "Horizontal extent of flooding inland from the shoreline. Depends on runup height, coastal topography, and surface roughness.",
  },
};

export function getGlossaryEntry(key: string): GlossaryEntry | undefined {
  return GLOSSARY[key.toLowerCase().replace(/[\s_-]+/g, "_")];
}

export function getAllEntries(): GlossaryEntry[] {
  return Object.values(GLOSSARY);
}

export const GLOSSARY_KEYS = Object.keys(GLOSSARY);
