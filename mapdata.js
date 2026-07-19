'use strict';
// Map geometry for the in-app quest maps.
//
// Game coordinates map LINEARLY from `bounds` onto the SVG viewBox, and the
// SVG is drawn 180° from the conventional orientation (hence rotate: 180).
// Verified against tarkov.dev's own named landmarks — every one lands on the
// correct building. Geometry values come from tarkov.dev's public maps.json.
//
// Map artwork: "Escape from Tarkov SVG Maps Project" by Shebuka,
// https://github.com/the-hideout/tarkov-dev-svg-maps — CC BY-NC-SA 4.0.

const MAP_DATA = {
  Customs: {
    svg: 'maps/Customs.svg',
    viewBox: { w: 1062.4827, h: 535.17401 },
    bounds: [[698, -307], [-372, 237]], // [[x,z],[x,z]] in game coords
    rotate: 180,
    baseLayer: 'Ground_Level',
    // floors, checked in order; a point belongs to the first floor whose
    // height range AND (optional) footprint contains it, else the ground floor
    floors: [
      {
        name: 'Underground', svgLayer: 'Underground_Level',
        extents: [{ height: [-1000, 0.5], bounds: [
          [[635, -137], [620, -125]], [[473, -122], [458, -110]], [[314, -173], [308, -184]],
          [[349, -88], [323, -32]], [[219, -158], [193, -137]], [[122, -61], [88, -40]],
        ] }],
      },
      {
        name: '2nd Floor', svgLayer: 'Second_Floor',
        extents: [
          { height: [2.7, 6.5], bounds: [
            [[243, 190], [165, 125]], [[116, -83], [72, -170]], [[356, -30], [341, -84]],
            [[334, -52], [321, -59]], [[589, 10], [577, -1]], [[580, -104], [532, -134]],
            [[625, -120], [599, -139]],
          ] },
          { height: [5.7, 1000], bounds: [
            [[580, -104], [532, -134]], [[-199, -90], [-223, -131]], [[239, 3], [169, -160]],
            [[336, -56], [316, -95]], [[584, -46], [556, -92]], [[93, 0], [65, -22]],
          ] },
          { height: [14, 15], bounds: [[[497, -44], [450, -90]]] },
          { height: [3.9, 7.6], bounds: [[[73, 57], [22, -38]]] },
          { height: [4.4, 6.5], bounds: [[[119, -57], [100, -42]]] },
          { height: [4.6, 7.9], bounds: [[[279, -79], [246, -1.4]]] },
        ],
      },
      {
        name: '3rd Floor', svgLayer: 'Third_Floor',
        extents: [
          { height: [5.7, 1000], bounds: [[[243, 190], [165, 125]]] },
          { height: [7.7, 11.3], bounds: [[[73, -73], [22, -38]]] },
          { height: [6.7, 11.6], bounds: [[[126, -64], [88, -35]]] },
          { height: [8, 11.1], bounds: [[[279, -79], [246, -1.4]]] },
        ],
      },
    ],
    labels: [
      [-215, -119, 'Big Red'], [200, 150, 'Dorms'], [404, 31, 'New Gas'], [331, -173, 'Old Gas'],
      [201, -127, 'Fortress'], [83, -153, 'Crackhouse'], [567, -67, 'Streamer House'],
      [-69, 9, 'Main Bridge'], [110, 85, 'Sniper Hill'], [-288, -134, 'Storage'],
      [-211, -219, 'Trailer Park'], [-66, 46, 'Junk Bridge'], [106, -90, 'Repair Shop'],
      [491, 63, 'Sniper Ridge'], [75, -9, 'Old Construction'], [200, -13, 'Skeleton'],
      [390, -94, 'Warehouse 3'], [472, -67, 'Depot'], [555, -118, 'Warehouse 7'],
      [572, 0, 'Military Checkpoint'], [238, 53, 'Bus Station'], [333, -67, 'Warehouse 4'],
      [497, 110, 'Powerline Tower'], [46, -59, 'Warehouse 17'],
    ],
  },
};

// game (x,z) -> svg viewBox coordinates
function gameToSvg(md, x, z) {
  const [[x1, z1], [x2, z2]] = md.bounds;
  return {
    x: (x - x1) / (x2 - x1) * md.viewBox.w,
    y: (z - z1) / (z2 - z1) * md.viewBox.h,
  };
}

// is (x,z) inside a [[ax,az],[bx,bz]] rectangle (corners in either order)
function inRect(x, z, rect) {
  const [[ax, az], [bx, bz]] = rect;
  return x >= Math.min(ax, bx) && x <= Math.max(ax, bx)
    && z >= Math.min(az, bz) && z <= Math.max(az, bz);
}

// which floor a point belongs to: index into md.floors, or -1 for ground
function floorOf(md, x, y, z) {
  for (let i = 0; i < md.floors.length; i++) {
    for (const ex of md.floors[i].extents) {
      const [hMin, hMax] = ex.height;
      if (y < hMin || y > hMax) continue;
      if (!ex.bounds || ex.bounds.some((r) => inRect(x, z, r))) return i;
    }
  }
  return -1;
}

if (typeof module !== 'undefined') module.exports = { MAP_DATA, gameToSvg, inRect, floorOf };
