/** Живой кабинет магазина. СБП здесь включают, shopId копируют. */

export const YOOKASSA_SHOP_SETTINGS = "https://yookassa.ru/my/shop-settings";
export const YOOKASSA_PAYMENTS = "https://yookassa.ru/my/payments";

export const SHOP_ACCORDION = ["Настройки", "Магазин", "Интеграция"] as const;

export function looksLikeYookassaSecret(value: string): boolean {
  return /^(live|test)_[A-Za-z0-9_-]{16,}$/.test(String(value || "").trim());
}

export function looksLikeYookassaShopId(value: string): boolean {
  return /^\d{5,12}$/.test(String(value || "").trim());
}

export function shopSetupSteps(): string[] {
  return [
    `Открой ${YOOKASSA_SHOP_SETTINGS}`,
    "«Настройки» — аккордеон: URL не меняется. Не вызывай click_kit и не жми ту же кнопку снова.",
    "Жми появившийся пункт «Магазин» или «Интеграция».",
    "Скопируй идентификатор магазина (shopId, только цифры) в Приём оплаты.",
    "Секрет вида live_… / test_… — в секрет приёма карт. Это ЮKassa, не токен истории ЮMoney.",
    "В способах оплаты магазина включи СБП. Без этого API не отдаст QR СБП.",
    "HTTP-уведомления на 127.0.0.1 ЮKassa не достучится. Кодер проверяет платёж по API кнопкой «Проверить оплату».",
  ];
}

export function shopSetupAdvice(): string {
  return shopSetupSteps().join(" ");
}
