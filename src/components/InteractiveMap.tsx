import React, { useEffect, useMemo } from 'react';
import L from 'leaflet';
import {
  Circle,
  MapContainer,
  Marker,
  Popup,
  TileLayer,
  useMap,
  useMapEvents,
} from 'react-leaflet';
import {
  CATEGORY_CATALOG,
  STATUS_LABELS,
  URGENCY_LABELS,
  type CitizenReport,
} from '../types';
import { formatTimestamp, type SpatialHotspot } from '../utils/geoAndImage';

function createPinIcon(hexColor: string, isUrgent = false): L.DivIcon {
  const ring = isUrgent ? '#991b1b' : '#ffffff';
  const size = isUrgent ? 30 : 26;
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size + 8}" viewBox="0 0 28 36" fill="none">
      <path d="M14 1C7.37258 1 2 6.37258 2 13C2 21.5 14 34.5 14 34.5C14 34.5 26 21.5 26 13C26 6.37258 20.6274 1 14 1Z" fill="${hexColor}" stroke="${ring}" stroke-width="2.2"/>
      <circle cx="14" cy="13" r="4.5" fill="#ffffff"/>
    </svg>
  `;
  return L.divIcon({
    html: svg,
    className: 'bg-transparent border-0',
    iconSize: [size, size + 8],
    iconAnchor: [size / 2, size + 6],
    popupAnchor: [0, -(size + 2)],
  });
}

const PICKER_ICON = createPinIcon('#0f172a', false);

function MapViewportUpdater({ center, zoom }: { center: [number, number]; zoom?: number }) {
  const map = useMap();
  useEffect(() => {
    map.setView(center, zoom ?? map.getZoom(), { animate: true });
  }, [center[0], center[1], zoom, map]);
  return null;
}

function MapClickHandler({ onSelectLocation }: { onSelectLocation?: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e) {
      if (onSelectLocation) {
        onSelectLocation(e.latlng.lat, e.latlng.lng);
      }
    },
  });
  return null;
}

interface InteractiveMapProps {
  center: { lat: number; lng: number };
  zoom?: number;
  heightClass?: string;
  mode?: 'explorer' | 'picker';
  selectedPin?: { lat: number; lng: number } | null;
  onSelectLocation?: (lat: number, lng: number) => void;
  reports?: CitizenReport[];
  hotspots?: SpatialHotspot[];
  showHotspots?: boolean;
  onSelectReport?: (report: CitizenReport) => void;
}

export const InteractiveMap: React.FC<InteractiveMapProps> = ({
  center,
  zoom = 15,
  heightClass = 'h-96',
  mode = 'explorer',
  selectedPin,
  onSelectLocation,
  reports = [],
  hotspots = [],
  showHotspots = false,
  onSelectReport,
}) => {
  const categoryIcons = useMemo(() => {
    const map: Record<string, L.DivIcon> = {};
    for (const key of Object.keys(CATEGORY_CATALOG)) {
      const cat = CATEGORY_CATALOG[key as keyof typeof CATEGORY_CATALOG];
      map[`${key}_normal`] = createPinIcon(cat.markerHex, false);
      map[`${key}_urgent`] = createPinIcon(cat.markerHex, true);
    }
    return map;
  }, []);

  return (
    <div className={`w-full ${heightClass} rounded-lg overflow-hidden border border-slate-200 relative bg-slate-100`}>
      <MapContainer
        center={[center.lat, center.lng]}
        zoom={zoom}
        scrollWheelZoom={true}
        className="w-full h-full"
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        <MapViewportUpdater center={[center.lat, center.lng]} zoom={zoom} />

        {mode === 'picker' && onSelectLocation && (
          <MapClickHandler onSelectLocation={onSelectLocation} />
        )}

        {mode === 'picker' && selectedPin && (
          <Marker position={[selectedPin.lat, selectedPin.lng]} icon={PICKER_ICON}>
            <Popup>
              <div className="text-xs space-y-1">
                <p className="font-semibold text-slate-900">Titik Lokasi Kejadian</p>
                <p className="font-mono text-slate-600">
                  {selectedPin.lat.toFixed(5)}, {selectedPin.lng.toFixed(5)}
                </p>
              </div>
            </Popup>
          </Marker>
        )}

        {showHotspots &&
          hotspots
            .filter((h) => h.riskScore > 0)
            .map((h) => {
              const strokeColor =
                h.riskLevel === 'tinggi'
                  ? '#dc2626'
                  : h.riskLevel === 'waspada'
                  ? '#d97706'
                  : '#16a34a';
              const radiusMeters = Math.min(280, Math.max(85, 70 + h.riskScore * 5));
              return (
                <Circle
                  key={h.id}
                  center={[h.lat, h.lng]}
                  radius={radiusMeters}
                  pathOptions={{
                    color: strokeColor,
                    fillColor: strokeColor,
                    fillOpacity: h.riskLevel === 'tinggi' ? 0.24 : 0.14,
                    weight: 1.5,
                  }}
                >
                  <Popup>
                    <div className="text-xs space-y-1 min-w-44">
                      <p className="font-semibold text-slate-900">
                        Zona Pemantauan {h.rt} · RW 013
                      </p>
                      <p className="text-slate-600">
                        Tingkat Risiko:{' '}
                        <span className="font-semibold uppercase">{h.riskLevel}</span> (Skor{' '}
                        <span className="font-mono">{h.riskScore}</span>)
                      </p>
                      <p className="text-slate-600 font-mono">
                        Laporan: {h.reportCount} · Aktif: {h.unresolvedCount}
                      </p>
                      {h.abjPercent !== null && (
                        <p className="text-slate-600 font-mono">
                          ABJ Jentik: {h.abjPercent}%
                        </p>
                      )}
                    </div>
                  </Popup>
                </Circle>
              );
            })}

        {mode === 'explorer' &&
          reports.map((rep) => {
            const isUrgent = rep.urgency === 'darurat' || rep.urgency === 'tinggi';
            const icon =
              categoryIcons[`${rep.category}_${isUrgent ? 'urgent' : 'normal'}`] || PICKER_ICON;
            const catMeta = CATEGORY_CATALOG[rep.category];

            return (
              <Marker
                key={rep.id}
                position={[rep.latitude, rep.longitude]}
                icon={icon}
              >
                <Popup>
                  <div className="w-56 space-y-2 text-xs">
                    {rep.photoDataUrl ? (
                      <img
                        src={rep.photoDataUrl}
                        alt={rep.title}
                        referrerPolicy="no-referrer"
                        className="w-full h-28 object-cover rounded border border-slate-200"
                      />
                    ) : null}
                    <div>
                      <p className="font-semibold text-slate-900 leading-snug">{rep.title}</p>
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        {catMeta?.shortLabel || rep.category} · {rep.rt} ·{' '}
                        {URGENCY_LABELS[rep.urgency]}
                      </p>
                    </div>
                    <p className="text-slate-600 line-clamp-2">{rep.description}</p>
                    <div className="pt-1 border-t border-slate-100 flex items-center justify-between gap-2">
                      <span className="text-[11px] font-medium text-slate-700">
                        {STATUS_LABELS[rep.status]}
                      </span>
                      <span className="text-[11px] font-mono text-slate-400">
                        {formatTimestamp(rep.createdAt)}
                      </span>
                    </div>
                    {onSelectReport && (
                      <button
                        type="button"
                        onClick={() => onSelectReport(rep)}
                        className="w-full mt-1 px-2.5 py-1.5 text-xs font-medium text-white bg-slate-900 rounded hover:bg-slate-800 transition-colors cursor-pointer"
                      >
                        Lihat Detail Laporan
                      </button>
                    )}
                  </div>
                </Popup>
              </Marker>
            );
          })}
      </MapContainer>
    </div>
  );
};
