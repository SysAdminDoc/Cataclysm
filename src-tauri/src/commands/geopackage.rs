use super::*;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GeoPackageExportResponse {
    pub destination: String,
    pub bytes: u64,
    pub layers: usize,
    pub features: usize,
    pub vertices: usize,
    pub source_digest: String,
    pub data_digest: String,
}

#[tauri::command]
pub fn save_geopackage(
    request: crate::geopackage::GeoPackageExportRequest,
    destination: String,
) -> Result<GeoPackageExportResponse, String> {
    let destination_path = std::path::PathBuf::from(&destination);
    let summary = crate::geopackage::write_geopackage(&request, &destination_path)?;
    Ok(GeoPackageExportResponse {
        destination,
        bytes: summary.bytes,
        layers: summary.layers,
        features: summary.features,
        vertices: summary.vertices,
        source_digest: summary.source_digest,
        data_digest: summary.data_digest,
    })
}
