/**
 * DELIBERATE DIVERGENCE from core's SidebarToggleButton.
 *
 * Differs from core:
 *   - Single 28px button at every breakpoint (core uses 44px on
 *     ≤480px for WCAG-2.5.5 touch targets). Tauri desktop is always
 *     mouse/trackpad; the responsive flip caused a jarring size
 *     change when resizing the window across the xs threshold.
 *   - macOS-only `marginLeft: 76px` shift so the button clears the
 *     traffic-light controls. Cleared in fullscreen mode.
 *   - <TauriDragRegion> overlay covering the top strip so the
 *     surrounding empty area drags the window.
 *
 * Inherits from core:
 *   - Full ARIA wiring: aria-label, aria-expanded, aria-controls.
 */

import { Button, Tooltip } from '@ziee/kit'
import { PanelLeft, PanelRight } from 'lucide-react'
import { isTauriView, isMacOS } from '@ziee/desktop/core/platform'
import { TauriDragRegion } from '@ziee/desktop/components/TauriDragRegion.tsx'
import { AppLayout } from '@/modules/layouts/app-layout/appLayout'

export function SidebarToggleButton() {
  const { isSidebarCollapsed, isFullscreen } = AppLayout

  // Tauri desktop is always mouse/trackpad — the WCAG-2.5.5 44px
  // touch target the core uses isn't required here. Keep a single
  // compact size so resizing the window across the xs threshold
  // doesn't morph the chevron (28px button at every breakpoint,
  // 20px icon that fits inside it cleanly — prior 30px icon
  // overflowed the 24px button and showed an oversized hover bg).

  // macOS Tauri traffic lights now start at x=20 (per
  // `backend/mod.rs`'s `traffic_light_position`), cluster width ~52px,
  // so they end around x=72. Shift the toggle right to x=84 — 12px
  // gap matches the spacing other macOS apps leave between the
  // traffic lights and the first toolbar control. Vanish in
  // fullscreen (no traffic lights).
  const macTrafficLightOffset =
    isTauriView && isMacOS && !isFullscreen ? 84 : 12

  // Full-width top-strip drag overlay (z:1) so pages WITHOUT a
  // HeaderBarContainer (NewChatPage etc.) and the sidebar's top
  // 50px both remain draggable. HeaderBarContainer raises its own
  // stacking level (`position: relative; z-index: 2`) so its
  // content paints above this overlay and its per-component
  // manual mousedown handler takes over there — that's how header
  // buttons stay clickable while the rest of the top strip drags.
  return (
    <>
      <TauriDragRegion
        className={'gap-6 fixed z-1 h-[50px] top-0 left-0 w-full'}
      />
      <div
        className="flex items-center gap-6 fixed z-10 h-[50px] top-0"
        style={{ marginLeft: macTrafficLightOffset }}
      >
        <Tooltip
          title={isSidebarCollapsed ? 'Open sidebar' : 'Close sidebar'}
          side="right"
        >
        <Button
          variant="ghost"
          data-testid="desktop-layout-sidebar-toggle-btn"
          onClick={AppLayout.toggleSidebar}
          className="flex items-center justify-center size-7 min-w-7 p-0 text-xl rounded"
          aria-label={
            isSidebarCollapsed
              ? 'Open navigation menu'
              : 'Close navigation menu'
          }
          aria-expanded={!isSidebarCollapsed}
          aria-controls="app-sidebar"
        >
          {/* Left sidebar: PanelLeft depicts the visible left panel when open;
              PanelRight when collapsed. size-5 (20px) — lucide icons don't scale
              with the button's fontSize the way the old react-icons glyphs did.
              Mirrors the web SidebarToggleButton.tsx sibling. */}
          {isSidebarCollapsed ? (
            <PanelRight className="size-5" aria-hidden="true" />
          ) : (
            <PanelLeft className="size-5" aria-hidden="true" />
          )}
        </Button>
        </Tooltip>
      </div>
    </>
  )
}
