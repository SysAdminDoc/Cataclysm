import { useI18n } from "../lib/i18n";
import { type MessageKey } from "../lib/i18n-core";
import {
  networkTrustManifest,
  type NetworkActivation,
  type NetworkDataKind,
  type NetworkPurpose,
} from "../lib/network-trust";

const PURPOSE_KEYS: Record<NetworkPurpose, MessageKey> = {
  "streamed-earth-context": "network.purpose.earth",
  "humanitarian-facilities": "network.purpose.facilities",
  "official-earthquake-data": "network.purpose.earthquakes",
  "near-earth-object-data": "network.purpose.objects",
  "historical-tsunami-data": "network.purpose.tsunamis",
};

const DATA_KEYS: Record<NetworkDataKind, MessageKey> = {
  "visible-tile-coordinates": "network.data.tiles",
  "optional-cesium-token": "network.data.token",
  "selected-hazard-bounds": "network.data.bounds",
  "public-event-identifier": "network.data.event",
  "object-search-terms": "network.data.objectTerms",
  "historical-search-terms": "network.data.historyTerms",
};

const ACTIVATION_KEYS: Record<NetworkActivation, MessageKey> = {
  "selected-online-map": "network.activation.map",
  "enabled-facility-layer": "network.activation.facilities",
  "opened-data-browser": "network.activation.browser",
  "submitted-search": "network.activation.search",
};

export function NetworkTrustPanel() {
  const { formatNumber, t } = useI18n();
  const { destinations, privacy, reviewed_at: reviewedAt } = networkTrustManifest;
  const originCount = destinations.reduce((total, destination) => total + destination.origins.length, 0);

  return (
    <section className="settings__section network-trust" aria-labelledby="network-trust-title">
      <div className="network-trust__heading">
        <div>
          <h3 className="settings__h3" id="network-trust-title">{t("network.heading")}</h3>
          <p className="modal__intro">{t("network.intro")}</p>
        </div>
        <span className="network-trust__offline">{t("network.offline")}</span>
      </div>

      <div className="network-trust__verification" role="status">
        <strong>{t("network.verified", { date: reviewedAt })}</strong>
        <span>{t("network.originCount", { count: formatNumber(originCount) })}</span>
      </div>

      <h4 className="network-trust__subheading">{t("network.privacyHeading")}</h4>
      <div className="network-trust__privacy">
        {!privacy.telemetry_enabled && (
          <article>
            <strong>{t("network.noTelemetryTitle")}</strong>
            <p>{t("network.noTelemetry")}</p>
          </article>
        )}
        {!privacy.device_location_collected && !privacy.device_location_transmitted && (
          <article>
            <strong>{t("network.noLocationTitle")}</strong>
            <p>{t("network.noLocation")}</p>
          </article>
        )}
        <article>
          <strong>{t("network.localCredentialsTitle")}</strong>
          <p>{t("network.localCredentials")}</p>
        </article>
      </div>
      {privacy.user_initiated_spatial_requests && (
        <p className="network-trust__spatial-note">{t("network.spatialNote")}</p>
      )}

      <div className="network-trust__origins-heading">
        <h4 className="network-trust__subheading">{t("network.originsHeading")}</h4>
        <span>{t("network.deniedByDefault")}</span>
      </div>
      <div className="network-trust__destinations">
        {destinations.map((destination) => (
          <article className="network-trust__destination" key={destination.id}>
            <header>
              <strong>{destination.label}</strong>
              <span data-authority={destination.authority}>
                {t(destination.authority === "webview-csp" ? "network.webview" : "network.native")}
              </span>
            </header>
            <p>{t(PURPOSE_KEYS[destination.purpose])}</p>
            <ul className="network-trust__origin-list" aria-label={t("network.originsFor", { provider: destination.label })}>
              {destination.origins.map((origin) => <li key={origin}><code>{origin}</code></li>)}
            </ul>
            <dl>
              <div>
                <dt>{t("network.sendsLabel")}</dt>
                <dd>{destination.sends.map((kind) => t(DATA_KEYS[kind])).join(" · ")}</dd>
              </div>
              <div>
                <dt>{t("network.activationLabel")}</dt>
                <dd>{t(ACTIVATION_KEYS[destination.activation])}</dd>
              </div>
            </dl>
          </article>
        ))}
      </div>

      {privacy.external_links_open_in_system_browser && (
        <p className="modal__footnote network-trust__external">{t("network.externalLinks")}</p>
      )}
    </section>
  );
}
