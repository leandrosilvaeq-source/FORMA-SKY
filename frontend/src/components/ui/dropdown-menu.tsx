import { Menu as MenuPrimitive } from '@base-ui/react/menu'

import { cn } from '@/lib/utils'

const DropdownMenu = MenuPrimitive.Root

const DropdownMenuTrigger = MenuPrimitive.Trigger

function DropdownMenuContent({
  className,
  side = 'bottom',
  sideOffset = 4,
  align = 'start',
  ...props
}: MenuPrimitive.Popup.Props &
  Pick<MenuPrimitive.Positioner.Props, 'align' | 'alignOffset' | 'side' | 'sideOffset'>) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Positioner side={side} sideOffset={sideOffset} align={align} className="isolate z-50">
        <MenuPrimitive.Popup
          data-slot="dropdown-menu-content"
          className={cn(
            'bg-popover text-popover-foreground ring-foreground/10 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 relative z-50 min-w-40 origin-(--transform-origin) overflow-hidden rounded-lg p-1 shadow-md ring-1 duration-100',
            className,
          )}
          {...props}
        />
      </MenuPrimitive.Positioner>
    </MenuPrimitive.Portal>
  )
}

function DropdownMenuItem({ className, ...props }: MenuPrimitive.Item.Props) {
  return (
    <MenuPrimitive.Item
      data-slot="dropdown-menu-item"
      className={cn(
        'focus:bg-accent focus:text-accent-foreground data-highlighted:bg-accent data-highlighted:text-accent-foreground relative flex w-full cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-hidden select-none data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*=size-])]:size-4',
        className,
      )}
      {...props}
    />
  )
}

export { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem }
