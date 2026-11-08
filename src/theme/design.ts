// The shared library of the themes of the design system (design-lib/lib/theme, the submodule design-lib pinned on a tag)
// and its JSON Schema of a theme document (design-lib/schemas/theme-v2.schema.json): theme check, theme publish and
// theme prompt read a theme as the apps draw it and check its structure as the backend does, never with a copy.
export { families, formerSurfaces, maskOpacity, readTheme, removedSurfaces, type ReadTheme, type SurfaceColors } from '../../design-lib/lib/theme/index.js';
export { mask as MASK } from '../../design-lib/dist/web/tokens.js';
import schema from '../../design-lib/schemas/theme-v2.schema.json' with { type: 'json' };
export const THEME_SCHEMA = schema as unknown as Record<string, unknown>;
export { checkLayout, kindOfLayout, type LayoutRefusal, type WidgetRegistry } from '../../design-lib/lib/layout/index.js';
import registry from '../../design-lib/registry/widgets.json' with { type: 'json' };
/** The widget registry of the design system (design-lib/registry/widgets.json), the one the backend checks a layout with. */
export const WIDGET_REGISTRY = registry as unknown as import('../../design-lib/lib/layout/index.js').WidgetRegistry;
