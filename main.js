import L from 'leaflet';
import 'leaflet-routing-machine';

// Fix for default Leaflet icon paths
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

// Variable global para nuestro icono
let baseIconUrl = null;

// Función para remover el fondo blanco de la imagen
function createTransparentIcon(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imageData.data;
      
      // Remover pixeles blancos o muy claros
      for (let i = 0; i < data.length; i += 4) {
        if (data[i] > 220 && data[i+1] > 220 && data[i+2] > 220) {
          data[i+3] = 0; // Alpha 0 = Transparente
        }
      }
      ctx.putImageData(imageData, 0, 0);
      
      baseIconUrl = canvas.toDataURL('image/png');
      resolve();
    };
    img.src = src;
  });
}

// Inicializar el mapa centrado en Medellín
const map = L.map('map', { zoomControl: false }).setView([6.2442, -75.5812], 13);
L.control.zoom({ position: 'bottomright' }).addTo(map);

// Inicializar el icono
createTransparentIcon('/simple-bike.jpg').then(() => {
  // Inicialización completada
});

// Función para actualizar tamaño del icono dinámicamente según el zoom
function getDynamicIcon() {
  if (!baseIconUrl) return null;
  const zoom = map.getZoom();
  // El tamaño escala con el zoom (ej. zoom 13 = 26px, zoom 18 = 46px)
  const size = Math.max(20, Math.min(60, zoom * 4 - 26));
  
  return L.icon({
    iconUrl: baseIconUrl,
    iconSize: [size, size],
    iconAnchor: [size/2, size/2],
    className: 'bike-marker'
  });
}

// Escuchar cambios de zoom para redimensionar la cicla
map.on('zoomend', () => {
  if (userMarker && baseIconUrl) {
    userMarker.setIcon(getDynamicIcon());
  }
});

// Capa base oscura
L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
  attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
  subdomains: 'abcd',
  maxZoom: 20
}).addTo(map);

// Estado de los puntos destino
let userLocation = null;
const destinations = {};
for (let i = 1; i <= 8; i++) destinations[i] = null;

// Crear 8 controles de enrutamiento independientes
const colors = {
  1: '#ffffff', // Blanco
  2: '#fbbf24', // Amarillo
  3: '#ef4444', // Rojo
  4: '#22c55e', // Verde
  5: '#3b82f6', // Azul
  6: '#a855f7', // Púrpura
  7: '#f97316', // Naranja
  8: '#06b6d4'  // Cyan
};

const routingControls = {};

for (let i = 1; i <= 8; i++) {
  routingControls[i] = L.Routing.control({
    waypoints: [],
    router: L.Routing.osrmv1({
      serviceUrl: 'https://routing.openstreetmap.de/routed-bike/route/v1' // Servidor público de OSRM para bicicletas
    }),
    lineOptions: {
      styles: [{ color: colors[i], opacity: 0.9, weight: 6 }]
    },
    show: false,
    addWaypoints: false, 
    fitSelectedRoutes: false, // <-- ESTO EVITA QUE EL MAPA HAGA ZOOM AUTOMÁTICO
    createMarker: function() { return null; }
  }).addTo(map);
}

// Marcadores de destino visuales
const destinationMarkers = {};

// Función para comparar waypoints y evitar peticiones repetidas al servidor
function areWaypointsEqual(wpA, wpB) {
  const coordsA = wpA.map(w => w && w.latLng).filter(l => l);
  const coordsB = wpB.map(w => w && w.latLng).filter(l => l);
  
  if (coordsA.length !== coordsB.length) return false;
  for(let i = 0; i < coordsA.length; i++) {
    // Si la distancia entre el punto antiguo y el nuevo es mayor a 15 metros, actualizamos.
    // Esto evita que el pequeño movimiento del GPS sature el servidor calculando rutas por cada centímetro.
    if (coordsA[i].distanceTo(coordsB[i]) > 15) {
      return false;
    }
  }
  return true;
}

// Función para actualizar las rutas (Solo actualiza las que cambiaron)
function updateRoutes() {
  const newWaypoints = {};

  // Ruta 1: User -> Dest1
  if (userLocation && destinations[1]) {
    newWaypoints[1] = [L.Routing.waypoint(userLocation), L.Routing.waypoint(destinations[1])];
  } else {
    newWaypoints[1] = [];
  }

  // Rutas 2 a 8
  for (let i = 2; i <= 8; i++) {
    if (destinations[i-1] && destinations[i]) {
      newWaypoints[i] = [L.Routing.waypoint(destinations[i-1]), L.Routing.waypoint(destinations[i])];
    } else {
      newWaypoints[i] = [];
    }
  }

  // Aplicar solo si hubo cambios
  for (let i = 1; i <= 8; i++) {
    const currentWp = routingControls[i].getWaypoints();
    if (!areWaypointsEqual(currentWp, newWaypoints[i])) {
      routingControls[i].setWaypoints(newWaypoints[i]);
    }
  }
}

// Función de Reverse Geocoding (Obtener dirección desde coordenadas)
async function getAddressFromCoords(lat, lng) {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`;
    const response = await fetch(url);
    const data = await response.json();
    if (data && data.display_name) {
      const addr = data.address;
      if (addr.road) {
        return `${addr.road} ${addr.house_number || ''}, ${addr.suburb || addr.neighbourhood || addr.city || ''}`;
      }
      return data.display_name.split(',').slice(0, 2).join(',');
    }
  } catch (e) {
    console.error('Error en reverse geocoding', e);
  }
  return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
}

// Estado de desbloqueo de marcadores
const unlockedMarkers = {};

// Función para crear o actualizar un marcador de destino arrastrable
async function setDestinationMarker(targetId, latLng) {
  destinations[targetId] = latLng;
  
  if (destinationMarkers[targetId]) {
    destinationMarkers[targetId].setLatLng(latLng);
  } else {
    destinationMarkers[targetId] = L.marker(latLng, {
      title: `Etapa ${targetId}`,
      draggable: !!unlockedMarkers[targetId] // Solo arrastrable si está desbloqueado
    }).bindPopup(`Meta ${targetId}`).addTo(map);

    // Evento al terminar de arrastrar el marcador
    destinationMarkers[targetId].on('dragend', async function(e) {
      const newPos = e.target.getLatLng();
      destinations[targetId] = newPos;
      
      const statusPill = document.getElementById('status-pill');
      statusPill.innerText = 'Actualizando dirección...';
      
      // Actualizar rutas sin hacer flyTo (para no dañar el zoom del usuario)
      updateRoutes();
      
      // Obtener nueva dirección y actualizar el input
      const address = await getAddressFromCoords(newPos.lat, newPos.lng);
      document.getElementById(`dest${targetId}`).value = address;
      statusPill.innerText = `Punto ${targetId} reubicado`;
    });
  }
}

// Geocoding con Nominatim (Búsqueda de direcciones en Medellín)
async function searchAddress(query, targetId) {
  const statusPill = document.getElementById('status-pill');
  statusPill.innerText = 'Buscando...';
  
  // Limitar búsqueda a Medellín usando viewbox
  const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query + ', Medellin, Antioquia, Colombia')}&limit=1`;
  
  try {
    const response = await fetch(url);
    const data = await response.json();
    
    if (data && data.length > 0) {
      const lat = parseFloat(data[0].lat);
      const lon = parseFloat(data[0].lon);
      const newDest = L.latLng(lat, lon);
      
      await setDestinationMarker(targetId, newDest);
      
      // REMOVIDO: map.flyTo(newDest, 14); para no desajustar el zoom del usuario
      // Solo hacemos un panTo suave si el punto está muy lejos, pero mejor no hacer nada.
      
      statusPill.innerText = `Destino ${targetId} encontrado`;
      updateRoutes();
    } else {
      statusPill.innerText = 'Dirección no encontrada';
      alert('No se pudo encontrar la dirección. Intenta ser más específico.');
    }
  } catch (error) {
    console.error('Error buscando dirección:', error);
    statusPill.innerText = 'Error en búsqueda';
  }
}

// Event Listeners para botones de búsqueda
document.querySelectorAll('.search-btn').forEach(btn => {
  btn.addEventListener('click', (e) => {
    const targetId = e.target.getAttribute('data-target');
    const input = document.getElementById(`dest${targetId}`);
    if (input.value.trim() !== '') {
      searchAddress(input.value, targetId);
    }
  });
});

// Permitir presionar "Enter" en los inputs
for (let i = 1; i <= 8; i++) {
  document.getElementById(`dest${i}`).addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      const val = e.target.value;
      if (val.trim() !== '') searchAddress(val, i);
    }
  });
}

// --- NUEVA LÓGICA: BLOQUEO/DESBLOQUEO DE MARCADOR ---
document.querySelectorAll('.map-select-btn').forEach(btn => {
  btn.addEventListener('click', async (e) => {
    const targetId = e.target.getAttribute('data-target');
    
    // Si ya estaba desbloqueado, lo bloqueamos
    if (unlockedMarkers[targetId]) {
      unlockedMarkers[targetId] = false;
      e.target.classList.remove('selecting');
      if (destinationMarkers[targetId]) {
        destinationMarkers[targetId].dragging.disable();
      }
      document.getElementById('status-pill').innerText = `Marcador ${targetId} bloqueado.`;
      return;
    }
    
    // Si estaba bloqueado, lo desbloqueamos
    unlockedMarkers[targetId] = true;
    e.target.classList.add('selecting');
    
    // Si no existía, lo creamos en el centro de la pantalla
    if (!destinationMarkers[targetId]) {
      const centerLatLng = map.getCenter();
      document.getElementById(`dest${targetId}`).value = 'Obteniendo dirección...';
      
      await setDestinationMarker(targetId, centerLatLng);
      updateRoutes();
      
      const address = await getAddressFromCoords(centerLatLng.lat, centerLatLng.lng);
      document.getElementById(`dest${targetId}`).value = address;
    } else {
      // Si ya existía, simplemente lo habilitamos para mover
      destinationMarkers[targetId].dragging.enable();
    }
    
    document.getElementById('status-pill').innerText = `Marcador ${targetId} desbloqueado. ¡Arrástralo!`;
  });
});
// ----------------------------------------



// Lógica de seguimiento GPS
const trackBtn = document.getElementById('track-location');
const statusPill = document.getElementById('status-pill');
let watchId = null;
let userMarker = null;

trackBtn.addEventListener('click', () => {
  if (watchId !== null) {
    // Apagar GPS
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
    trackBtn.classList.remove('active');
    trackBtn.innerText = '📍 Activar mi GPS (Requerido)';
    statusPill.innerText = 'GPS Desactivado';
    if (userMarker) {
      map.removeLayer(userMarker);
      userMarker = null;
      userLocation = null;
    }
  } else {
    // Encender GPS
    if ('geolocation' in navigator) {
      trackBtn.classList.add('active');
      trackBtn.innerText = 'Buscando satélites...';
      statusPill.innerText = 'Buscando GPS...';
      
      watchId = navigator.geolocation.watchPosition(
        (position) => {
          const lat = position.coords.latitude;
          const lng = position.coords.longitude;
          userLocation = L.latLng(lat, lng);
          
          trackBtn.innerText = '📡 GPS Activo';
          statusPill.innerText = 'Ruta actualizada en vivo';

          if (!userMarker) {
            // Asegurarnos de que la imagen transparente haya cargado
            const currentIcon = getDynamicIcon();
            if (currentIcon) {
              userMarker = L.marker(userLocation, {
                icon: currentIcon,
                title: '¡Tú!'
              }).addTo(map);
            }
            map.flyTo(userLocation, 14);
          } else {
            userMarker.setLatLng(userLocation);
          }

          // Actualizar las rutas al moverse
          updateRoutes();
        },
        (error) => {
          console.error('Error GPS:', error);
          alert('Error de GPS. Verifica los permisos.');
          trackBtn.classList.remove('active');
          trackBtn.innerText = '📍 Activar mi GPS (Requerido)';
          statusPill.innerText = 'GPS Denegado';
          watchId = null;
        },
        { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 }
      );
    } else {
      alert('Tu navegador no soporta geolocalización.');
    }
  }
});

// Botón Limpiar
document.getElementById('reset-route').addEventListener('click', () => {
  for (let i = 1; i <= 8; i++) {
    destinations[i] = null;
    unlockedMarkers[i] = false;
    document.getElementById(`dest${i}`).value = '';
    
    const btn = document.querySelector(`.map-select-btn[data-target="${i}"]`);
    if (btn) btn.classList.remove('selecting');

    if (destinationMarkers[i]) {
      map.removeLayer(destinationMarkers[i]);
      destinationMarkers[i] = null;
    }
  }
  updateRoutes();
  document.getElementById('status-pill').innerText = 'Rutas limpias';
});
