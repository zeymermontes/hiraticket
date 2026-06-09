/** Business verticals (ported from the prototype) — for the Business config picker. */
export interface Vertical {
  id: string;
  icon: string;
  name: { es: string; en: string };
  object: { es: string; en: string };
  fields: { es: string; en: string }[];
}

export const VERTICALS: Vertical[] = [
  { id: "imprenta", icon: "sparkles", name: { es: "Imprenta", en: "Print shop" }, object: { es: "Pedido", en: "Order" }, fields: [{ es: "Tipo de papel", en: "Paper type" }, { es: "Acabado", en: "Finish" }] },
  { id: "restaurante", icon: "store", name: { es: "Restaurante", en: "Restaurant" }, object: { es: "Orden", en: "Order" }, fields: [{ es: "Mesa / Domicilio", en: "Table / Address" }, { es: "Alergias", en: "Allergies" }] },
  { id: "salon", icon: "sparkles", name: { es: "Estética / Salón", en: "Salon / Spa" }, object: { es: "Cita", en: "Appointment" }, fields: [{ es: "Servicio", en: "Service" }, { es: "Estilista", en: "Stylist" }] },
  { id: "veterinaria", icon: "shield", name: { es: "Veterinaria", en: "Vet clinic" }, object: { es: "Caso", en: "Case" }, fields: [{ es: "Mascota", en: "Pet" }, { es: "Especie", en: "Species" }] },
  { id: "retail", icon: "store", name: { es: "Tienda / Retail", en: "Retail store" }, object: { es: "Pedido", en: "Order" }, fields: [{ es: "SKU", en: "SKU" }, { es: "Talla/Color", en: "Size/Color" }] },
  { id: "taller", icon: "sliders", name: { es: "Taller / Refaccionaria", en: "Repair / Auto" }, object: { es: "Orden", en: "Work order" }, fields: [{ es: "Placa", en: "Plate" }, { es: "Modelo", en: "Model" }] },
  { id: "otro", icon: "sliders", name: { es: "Otro / Genérico", en: "Other / Generic" }, object: { es: "Pedido", en: "Order" }, fields: [] },
];
