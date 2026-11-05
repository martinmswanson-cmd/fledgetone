/**
 * Where a pointer is in an SVG's own drawing units (its viewBox), however the SVG is scaled and
 * centred on the page: a drawing kept to its shape inside a wider box isn't stretched, so mapping
 * by the box alone puts clicks beside the dots they are aimed at.
 */
export function svgPoint(svg: SVGSVGElement, clientX: number, clientY: number, w: number, h: number): [number, number] {
  const m = svg.getScreenCTM();
  if (m) {
    const p = new DOMPoint(clientX, clientY).matrixTransform(m.inverse());
    return [p.x, p.y];
  }
  const r = svg.getBoundingClientRect();
  return [((clientX - r.left) / r.width) * w, ((clientY - r.top) / r.height) * h];
}
