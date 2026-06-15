---
name: dual-mode
description: Enforce business-vs-personal mode (and ES/EN) on every user-facing feature in Hiraticket. Invoke BEFORE writing or reviewing any UI/text/money/terminology/stages change — i.e. anything a user sees in the app. Hiraticket runs in two modes: 'business' (pedidos, productos, clientes, dinero) and 'personal' (tareas, subtareas, contactos, sin dinero). This skill is the mapping + checklist so a feature never hardcodes one mode's wording or shows money in personal mode.
---

# Dual-mode (negocio ↔ gestión personal)

Hiraticket is one product with two workspace modes. **Every user-facing string and every
money element must adapt to the mode.** This is the #1 recurring bug class — hardcoded
"Pedido"/"Producto"/"Cliente" or a price showing in personal mode. Check this skill whenever a
change touches UI text, money, terminology, stages, or empty states.

## Where the flag comes from

- **Client components:** `const { lang, personal } = useApp();` — `personal: boolean` from
  `AppContext` (`src/components/AppContext.tsx`). `lang` is `"es" | "en"`.
- **Server (actions / lib / RSC):** `getMyBusiness()` → `business.mode === "personal"`
  (`Business.mode: "business" | "personal"` in `src/lib/types.ts`).
- **Worker (`services/whatsapp/`):** mode-AGNOSTIC. The Go worker never branches on mode — a
  pedido and a tarea are the same `orders` row; `order_items` are products or subtasks. Do NOT add
  mode logic to the worker. (One exception already in place: the activity-log event text "Pedido
  creado"/"Tarea creada" is chosen server-side in `createOrder` by reading `mode`.)

The data model is shared: `orders` = pedido/tarea, `order_items` = producto/subtarea,
`contacts` = cliente/contacto. Mode only changes **wording + whether money is shown**, never the
schema.

## The pattern

Always nest mode first, then language:

```tsx
const { lang, personal } = useApp();
personal
  ? (lang === "es" ? "Tarea" : "Task")
  : (lang === "es" ? "Pedido" : "Order")
```

For repeated labels in one component, hoist a `const`:
`const obj = personal ? (lang==="es"?"tarea":"task") : (lang==="es"?"pedido":"order");`

## Terminology map (business → personal)

| Concept            | Business (es / en)        | Personal (es / en)           |
|--------------------|---------------------------|------------------------------|
| order (singular)   | Pedido / Order            | Tarea / Task                 |
| orders (plural)    | Pedidos / Orders          | Tareas / Tasks               |
| line item          | Producto·Artículo / Item  | Subtarea / Subtask           |
| add line item      | Agregar producto          | Agregar subtarea             |
| customer           | Cliente / Customer        | Contacto / Contact           |
| customers          | Clientes / Customers      | Contactos / Contacts         |
| order stage        | Etapa del pedido          | Etapa de la tarea            |
| create CTA         | Crear/Nuevo pedido        | Crear/Nueva tarea            |
| empty state        | Sin pedidos / No orders   | Sin tareas / No tasks        |
| catalog            | Catálogo (productos)      | Tareas repetitivas / Recurring tasks |
| config nav item    | Negocio / Business        | Espacio / Workspace          |
| reports            | Ventas, ticket, dinero    | Métricas de tareas (sin dinero) |

Note: business line items appear as **"Artículo"** in some spots (e.g. "Artículos del pedido")
and **"Producto"** in others (e.g. the note button). Match the wording already used in the
surrounding component rather than introducing a third variant.

## Money rule (the other half)

In **personal** mode there is NO money. Wrap every monetary element in `{!personal && ...}`:
prices, unit prices, price tiers, totals, balance, the entire **Payments** block, `$` inputs,
money columns in tables, and money figures in reports/exports (CSV). Personal mode shows only
quantities/notes/stages.

## Checklist for any user-facing change

1. Does the new string have a business AND a personal wording? Use the map; never hardcode one.
2. Did you also provide ES and EN? (mode first, then `lang`.)
3. Any price/total/payment/`$`? Gate with `{!personal && ...}`.
4. New empty state / placeholder / button / column header / toast / CSV header → all mode-aware.
5. Server action writing activity-log/event text → pick the noun from `mode`.
6. Did you touch the worker? It must stay mode-agnostic.
7. Default stages on creation differ by mode (`createBusiness` seeds task-oriented stages for
   personal) — keep that intact.

## Verify before finishing

Grep the files you changed for hardcoded single-mode words that aren't inside a `personal ? …`
ternary:

```
grep -nE "Pedido|pedido|Producto|producto|Artículo|Cliente|cliente|\$\{?[a-z].*total" <files>
```

Each hit should either be inside a `personal ?` branch or be genuinely mode-neutral. Then run
`npx tsc --noEmit` and `npm run build`.
