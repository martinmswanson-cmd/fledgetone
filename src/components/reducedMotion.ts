/**
 * Scrolling that glides into place, unless the system asks for less motion (then it jumps there):
 * for scrollIntoView and scrollTo.
 */
export const scrollBehavior = (): ScrollBehavior => (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth');
