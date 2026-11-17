// The few H3 operations the CLI needs to turn a place into the map cells of an area (explore search --near,
// --where): the cell of a point (latLngToCell) and the parent of a cell, without a dependency (D-91). Ported from
// the C library H3 v4.1.0 (Uber Technologies, Apache License 2.0: https://github.com/uber/h3), its functions
// latLngToCell, _geoToFaceIjk, _hex2dToCoordIJK, _faceIjkToH3 and the tables they read; checked against h3-js.

const NUM_FACES = 20;
const RES0_U_GNOMONIC = 0.38196601125010500003;
const M_AP7_ROT_RADS = 0.333473172251832115336090755351601070065900389;
const M_SQRT7 = 2.6457513110645905905016157536392604257102;
const M_SIN60 = 0.8660254037844386467637231707529361834714;
const M_2PI = 2 * Math.PI;
const EPSILON = 1e-16;
const MAX_FACE_COORD = 2;

/** The centres of the faces of the icosahedron (lat, lng in radians). */
const FACE_CENTER_GEO = [0.80358264971899, 1.2483974196173961, 1.3077478834556382, 2.5369450098779214, 1.054751253523952, -1.3475173589003966, 0.6001915955381868, -0.45060390946975576, 0.49171542819877384, 0.40198820291130694, 0.1727453274156187, 1.6781468852804338, 0.6059293215713507, 2.9539233298124117, 0.42737051832897965, -1.8888762003362853, -0.07906611854921283, -0.7334295133808677, -0.23096164445538364, 0.506495587332349, 0.07906611854921283, 2.4081631402089254, 0.23096164445538364, -2.635097066257444, -0.1727453274156187, -1.4634457683093596, -0.6059293215713507, -0.18766932377738163, -0.42737051832897965, 1.2527164532535078, -0.6001915955381868, 2.6909887441200375, -0.49171542819877384, -2.7396044506784865, -0.80358264971899, -1.8931952339723972, -1.3077478834556382, -0.6046476437118721, -1.054751253523952, 1.7940752946893965];
/** The same centres on the unit sphere (x, y, z). */
const FACE_CENTER_POINT = [0.2199307791404606, 0.6583691780274996, 0.7198475378926182, -0.2139234834501421, 0.1478171829550703, 0.9656017935214205, 0.1092625278784797, -0.481195157287321, 0.8697775121287253, 0.7428567301586791, -0.3593941678278028, 0.5648005936517033, 0.8112534709140969, 0.3448953237639384, 0.472138773641393, -0.1055498149613921, 0.9794457296411413, 0.1718874610009365, -0.8075407579970092, 0.1533552485898818, 0.5695261994882688, -0.2846148069787907, -0.8644080972654206, 0.4144792552473539, 0.7405621473854482, -0.6673299564565524, -0.0789837646326737, 0.8512303986474293, 0.4722343788582681, -0.2289137388687808, -0.7405621473854481, 0.6673299564565524, 0.0789837646326737, -0.8512303986474292, -0.4722343788582682, 0.2289137388687808, 0.1055498149613919, -0.9794457296411413, -0.1718874610009365, 0.8075407579970092, -0.1533552485898819, -0.5695261994882688, 0.2846148069787908, 0.8644080972654204, -0.4144792552473539, -0.7428567301586791, 0.3593941678278027, -0.5648005936517033, -0.811253470914097, -0.3448953237639382, -0.472138773641393, -0.2199307791404607, -0.6583691780274996, -0.7198475378926182, 0.213923483450142, -0.1478171829550704, -0.9656017935214205, -0.1092625278784796, 0.481195157287321, -0.8697775121287253];
/** The azimuth of the i axis (Class II) of each face, in radians. */
const FACE_AXIS_I = [5.6199582685239395, 5.7603390817141875, 0.78021365439343, 0.4304693639799999, 6.130269123335111, 2.692877706530643, 2.982963003477244, 3.532912002790141, 3.494305004259568, 3.0032141694995382, 5.930472956509812, 0.13837848409025486, 0.4487149470591504, 0.15862965011254937, 5.891865957979238, 2.711123289609793, 3.294508837434268, 3.80481969224544, 3.6644388790551923, 2.361378999196363];
/** The base cell and its 60° counter-clockwise rotations of each face and resolution 0 ijk (0 to 2 each): baseCell × 6 + rotations. */
const FACE_IJK_BASE_CELLS = [96,108,144,198,180,195,295,291,303,48,35,65,132,96,108,247,198,180,24,5,17,91,48,35,187,132,96,12,36,84,60,66,105,145,141,153,0,11,59,30,12,36,109,60,66,25,23,47,49,0,11,97,30,12,42,126,228,54,114,207,85,123,219,18,83,179,6,42,126,37,54,114,26,77,161,1,18,83,13,6,42,156,252,348,174,258,375,229,285,387,72,173,269,78,156,252,127,174,258,27,95,191,19,72,173,43,78,156,186,246,294,264,318,369,349,393,453,90,137,203,168,186,246,253,264,318,28,53,101,73,90,137,157,168,186,300,288,297,192,183,201,147,111,99,420,402,399,315,300,288,225,192,183,498,525,513,447,420,402,343,315,300,150,138,147,102,69,63,87,39,15,270,234,225,213,150,138,165,102,69,378,357,345,339,270,234,279,213,150,216,120,87,204,117,57,231,129,45,330,240,165,327,216,120,309,204,117,432,363,279,441,330,240,429,327,216,384,282,231,372,261,177,351,255,159,504,414,309,495,384,282,459,372,261,582,537,429,591,504,414,579,495,384,450,390,351,366,321,267,297,249,189,564,516,459,489,450,390,399,366,321,642,627,579,609,564,516,513,489,450,342,354,381,444,471,477,501,555,573,222,237,273,312,342,354,423,444,471,144,141,153,195,222,237,303,312,342,276,360,435,336,411,483,381,465,543,162,243,333,210,276,360,273,336,411,84,123,219,105,162,243,153,210,276,426,534,585,438,549,621,435,531,633,306,417,507,324,426,534,333,438,549,228,285,387,207,306,417,219,324,426,576,624,645,588,663,693,585,669,717,456,519,567,492,576,624,507,588,663,348,393,453,375,456,519,387,492,576,510,522,501,606,615,603,645,675,687,396,405,423,486,510,522,567,606,615,294,291,303,369,396,405,453,486,510,570,552,498,474,468,447,379,357,345,654,648,605,559,570,552,463,474,468,706,713,689,637,654,648,541,559,570,540,462,378,480,408,339,433,363,279,636,558,479,595,540,462,529,480,408,705,659,575,679,636,558,631,595,540,630,528,432,618,546,441,583,537,429,678,594,485,697,630,528,667,618,546,704,641,545,727,678,594,715,697,630,714,666,582,690,660,591,643,627,579,726,696,623,721,714,666,673,690,660,703,683,635,709,726,696,685,721,714,684,672,642,600,612,609,499,525,513,708,720,695,649,684,672,553,600,612,702,731,719,655,708,720,571,649,684];
/** The pentagon base cells and their clockwise offset faces. */
const PENTAGONS: Record<number, [number, number]> = { 4: [-1, -1], 14: [2, 6], 24: [1, 5], 38: [3, 7], 49: [0, 9], 58: [4, 8], 63: [11, 15], 72: [12, 16], 83: [10, 19], 97: [13, 17], 107: [14, 18], 117: [-1, -1] };
/** The unit vectors of the digits 0 to 6 (ijk). */
const UNIT_VECS = [[0, 0, 0], [0, 0, 1], [0, 1, 0], [0, 1, 1], [1, 0, 0], [1, 0, 1], [1, 1, 0]];
const K_AXES_DIGIT = 1;
const CCW = [0, 5, 3, 1, 6, 4, 2];
const CW = [0, 3, 6, 2, 5, 1, 4];

type Ijk = [number, number, number];
const posAngle = (a: number) => { const t = a < 0 ? a + M_2PI : a; return a >= M_2PI ? t - M_2PI : t; };
/** lroundl: half away from zero. */
const lround = (x: number) => Math.sign(x) * Math.round(Math.abs(x));
const classIII = (res: number) => res % 2 === 1;

function normalize(c: Ijk): Ijk {
  let [i, j, k] = c;
  if (i < 0) { j -= i; k -= i; i = 0; }
  if (j < 0) { i -= j; k -= j; j = 0; }
  if (k < 0) { i -= k; j -= k; k = 0; }
  const min = Math.min(i, j, k);
  if (min > 0) { i -= min; j -= min; k -= min; }
  return [i, j, k];
}
const upAp7 = ([a, b, c]: Ijk): Ijk => { const i = a - c, j = b - c; return normalize([lround((3 * i - j) / 7), lround((i + 2 * j) / 7), 0]); };
const upAp7r = ([a, b, c]: Ijk): Ijk => { const i = a - c, j = b - c; return normalize([lround((2 * i + j) / 7), lround((3 * j - i) / 7), 0]); };
const down = (c: Ijk, iv: Ijk, jv: Ijk, kv: Ijk): Ijk => normalize([0, 1, 2].map((n) => iv[n] * c[0] + jv[n] * c[1] + kv[n] * c[2]) as Ijk);
const downAp7 = (c: Ijk) => down(c, [3, 0, 1], [1, 3, 0], [0, 1, 3]);
const downAp7r = (c: Ijk) => down(c, [3, 1, 0], [0, 3, 1], [1, 0, 3]);

/** The face and the hex2d coordinates of a point (radians) at [res]. */
function geoToHex2d(lat: number, lng: number, res: number): { face: number; x: number; y: number } {
  const r3 = Math.cos(lat);
  const v = [Math.cos(lng) * r3, Math.sin(lng) * r3, Math.sin(lat)];
  let face = 0, sqd = 5;
  for (let f = 0; f < NUM_FACES; f++) {
    const d = (FACE_CENTER_POINT[f * 3] - v[0]) ** 2 + (FACE_CENTER_POINT[f * 3 + 1] - v[1]) ** 2 + (FACE_CENTER_POINT[f * 3 + 2] - v[2]) ** 2;
    if (d < sqd) { face = f; sqd = d; }
  }
  let r = Math.acos(1 - sqd / 2);
  if (r < EPSILON) return { face, x: 0, y: 0 };
  const cLat = FACE_CENTER_GEO[face * 2], cLng = FACE_CENTER_GEO[face * 2 + 1];
  const azimuth = Math.atan2(Math.cos(lat) * Math.sin(lng - cLng), Math.cos(cLat) * Math.sin(lat) - Math.sin(cLat) * Math.cos(lat) * Math.cos(lng - cLng));
  let theta = posAngle(FACE_AXIS_I[face] - posAngle(azimuth));
  if (classIII(res)) theta = posAngle(theta - M_AP7_ROT_RADS);
  r = Math.tan(r) / RES0_U_GNOMONIC;
  for (let i = 0; i < res; i++) r *= M_SQRT7;
  return { face, x: r * Math.cos(theta), y: r * Math.sin(theta) };
}

/** The ijk coordinates of the cell that holds the hex2d point (x, y). */
function hex2dToIjk(x: number, y: number): Ijk {
  const a1 = Math.abs(x), a2 = Math.abs(y);
  const x2 = a2 / M_SIN60, x1 = a1 + x2 / 2;
  const m1 = Math.trunc(x1), m2 = Math.trunc(x2);
  const r1 = x1 - m1, r2 = x2 - m2;
  let i: number, j: number;
  if (r1 < 0.5) {
    if (r1 < 1 / 3) { i = m1; j = r2 < (1 + r1) / 2 ? m2 : m2 + 1; }
    else { j = r2 < 1 - r1 ? m2 : m2 + 1; i = 1 - r1 <= r2 && r2 < 2 * r1 ? m1 + 1 : m1; }
  } else if (r1 < 2 / 3) { j = r2 < 1 - r1 ? m2 : m2 + 1; i = 2 * r1 - 1 < r2 && r2 < 1 - r1 ? m1 : m1 + 1; }
  else { i = m1 + 1; j = r2 < r1 / 2 ? m2 : m2 + 1; }
  if (x < 0) {
    if (j % 2 === 0) { const diff = i - Math.trunc(j / 2); i -= 2 * diff; }
    else { const diff = i - Math.trunc((j + 1) / 2); i -= 2 * diff + 1; }
  }
  if (y < 0) { i -= Math.trunc((2 * j + 1) / 2); j = -j; }
  return normalize([i, j, 0]);
}

const digitShift = (r: number) => BigInt((15 - r) * 3);
const getDigit = (h: bigint, r: number) => Number((h >> digitShift(r)) & 7n);
const setDigit = (h: bigint, r: number, d: number) => (h & ~(7n << digitShift(r))) | (BigInt(d) << digitShift(r));
const resolutionOfIndex = (h: bigint) => Number((h >> 52n) & 15n);
const leadingDigit = (h: bigint) => { for (let r = 1; r <= resolutionOfIndex(h); r++) { const d = getDigit(h, r); if (d) return d; } return 0; };
const rotate = (h: bigint, table: number[]) => { for (let r = 1; r <= resolutionOfIndex(h); r++) h = setDigit(h, r, table[getDigit(h, r)]); return h; };
function rotatePent60ccw(h: bigint): bigint {
  let found = false;
  for (let r = 1; r <= resolutionOfIndex(h); r++) {
    h = setDigit(h, r, CCW[getDigit(h, r)]);
    if (!found && getDigit(h, r) !== 0) { found = true; if (leadingDigit(h) === K_AXES_DIGIT) h = rotate(h, CCW); }
  }
  return h;
}

/** The H3 cell (15 hexadecimal digits) of resolution [res] (0 to 15) that holds the point [lat], [lng] in degrees. */
export function latLngToCell(lat: number, lng: number, res: number): string {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || !Number.isInteger(res) || res < 0 || res > 15) throw new RangeError('latLngToCell: a latitude of -90 to 90, a finite longitude, a resolution of 0 to 15');
  const { face, x, y } = geoToHex2d(lat * Math.PI / 180, lng * Math.PI / 180, res);
  let ijk = hex2dToIjk(x, y);
  // The index: mode 1 (a cell), the resolution, every digit 7 until set.
  let h = (1n << 59n) | (BigInt(res) << 52n) | ((1n << 45n) - 1n);
  for (let r = res - 1; r >= 0; r--) {
    const last = ijk;
    let center: Ijk;
    if (classIII(r + 1)) { ijk = upAp7(ijk); center = downAp7(ijk); } else { ijk = upAp7r(ijk); center = downAp7r(ijk); }
    const diff = normalize([last[0] - center[0], last[1] - center[1], last[2] - center[2]]);
    h = setDigit(h, r + 1, UNIT_VECS.findIndex((u) => u[0] === diff[0] && u[1] === diff[1] && u[2] === diff[2]));
  }
  if (ijk.some((c) => c > MAX_FACE_COORD)) throw new RangeError('latLngToCell: out of range');
  const entry = FACE_IJK_BASE_CELLS[face * 27 + ijk[0] * 9 + ijk[1] * 3 + ijk[2]];
  const baseCell = Math.floor(entry / 6), rotations = entry % 6;
  h |= BigInt(baseCell) << 45n;
  const pentagon = PENTAGONS[baseCell];
  if (pentagon) {
    if (leadingDigit(h) === K_AXES_DIGIT) h = pentagon.includes(face) ? rotate(h, CW) : rotate(h, CCW);
    for (let i = 0; i < rotations; i++) h = rotatePent60ccw(h);
  } else {
    for (let i = 0; i < rotations; i++) h = rotate(h, CCW);
  }
  return h.toString(16);
}

/** Whether [cell] reads as an H3 cell (mode 1, 15 hexadecimal digits). */
export const isCell = (cell: string) => /^8[0-9a-f]{14}$/i.test(cell) && resolutionOfIndex(BigInt(`0x${cell}`)) <= 15;
/** The resolution of an H3 cell. */
export const cellResolution = (cell: string) => resolutionOfIndex(BigInt(`0x${cell}`));
/** The parent of [cell] at [res] (its own resolution or coarser). */
export function cellToParent(cell: string, res: number): string {
  let h = BigInt(`0x${cell}`);
  const own = resolutionOfIndex(h);
  if (res > own || res < 0) throw new RangeError(`cellToParent: a resolution of 0 to ${own}`);
  h = (h & ~(15n << 52n)) | (BigInt(res) << 52n);
  for (let r = res + 1; r <= 15; r++) h = setDigit(h, r, 7);
  return h.toString(16);
}
