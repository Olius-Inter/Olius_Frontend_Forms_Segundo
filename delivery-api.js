export function deliveryDTO({ idempotencyKey, qrToken, oilVolumeLiters, deliveryDate }) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idempotencyKey) ||
      !/^[A-Za-z0-9_-]{43}$/.test(qrToken)) throw new Error('Abra um link válido do participante pelo mobile.');
  if (typeof oilVolumeLiters !== 'number' || !Number.isFinite(oilVolumeLiters) || oilVolumeLiters <= 0 ||
      oilVolumeLiters > 999.99 || Math.abs(oilVolumeLiters * 100 - Math.round(oilVolumeLiters * 100)) > 1e-6) {
    throw new Error('Informe uma quantidade maior que zero, até 999,99 litros, com até duas casas decimais.');
  }
  if (typeof deliveryDate !== 'string' || !Number.isFinite(Date.parse(deliveryDate)) || Date.parse(deliveryDate) > Date.now()) {
    throw new Error('A data da entrega deve ser válida e não pode estar no futuro.');
  }
  return Object.freeze({ idempotencyKey, qrToken, oilVolumeLiters, deliveryDate });
}
