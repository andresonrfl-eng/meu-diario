// Configuração da nuvem (Supabase).
// Preencha com os dados do seu projeto em: Supabase > Project Settings > API.
// A chave "anon"/"publishable" é PÚBLICA por natureza — pode ficar no código.
// Quem protege os dados é o Row Level Security (veja supabase/schema.sql).
// NUNCA coloque aqui a chave "service_role" / "secret".
//
// Enquanto estiver vazio, o app funciona apenas no aparelho (sem sincronizar).
export const SUPABASE_URL = 'https://fusyhpwqspbidtarkxbe.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_vPm32IbV87yIgCyVklhqSg_N5jGtI0P';

// Chave PÚBLICA das notificações (lembrete diário). A privada fica só nos segredos
// da função send-reminders no Supabase — nunca no código.
export const VAPID_PUBLIC_KEY = 'BP7KuqyXTKEraMgLwhItHp9GwrGB7ti3z8GaWZ8rBTD-33f8bA7b2L6hNZsL_ef1iwItCYY1R7MGB4yUzws8-tM';
