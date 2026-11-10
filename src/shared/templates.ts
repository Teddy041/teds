import type { Bot, Template, ToolGroup } from "./types";
import { t } from "./i18n";

// Alan şablonları: her biri hazır bir bot ekibi ve kayıt tabloları getirir.
// Kullanıcı şablonu uyguladıktan sonra her şeyi değiştirebilir; şablonlar sadece başlangıç noktasıdır.

const ALL: ToolGroup[] = ["records", "memory", "team", "screen", "web"];

const LEAD_INTRO =
  "Ekibi sen yönetirsin. Kullanıcının isteğini anla; basit işleri kendin yap, uzmanlık gerektiren işleri " +
  "ilgili ekip arkadaşına devret ve sonucu kullanıcıya kısa ve net özetle. ";

function lead(name: string, extra: string): Omit<Bot, "id"> {
  return {
    name,
    emoji: "🧭",
    role: "Ekip lideri",
    instructions: LEAD_INTRO + extra,
    lead: true,
    tools: ALL,
    approval: "ask",
    effort: "medium",
  };
}

function bot(name: string, emoji: string, role: string, instructions: string, tools: ToolGroup[] = ["records", "memory"]): Omit<Bot, "id"> {
  return { name, emoji, role, instructions, lead: false, tools, approval: "ask", effort: "medium" };
}

const TEMPLATES: Template[] = [
  {
    id: "health",
    name: "Sağlık kurumu",
    kind: "Sağlık",
    description: "Klinik, poliklinik veya muayenehane: hasta kayıtları, randevular, faturalar.",
    bots: [
      lead("Teds", "Hasta bilgileri hassastır: gereksiz yere tekrar etme, sadece işin gerektirdiği kadarını paylaş. Tıbbi teşhis veya tedavi önerisi verme; bunu her zaman hekime bırak."),
      bot("Randevu", "📅", "Randevu sorumlusu", "Randevuları oluşturur, günceller ve çakışmaları kontrol eder. Bir randevu eklemeden önce aynı hekim ve saatte başka randevu olup olmadığına bak."),
      bot("Fatura", "🧾", "Fatura ve tahsilat", "Faturaları takip eder, ödenmemiş olanları listeler ve hatırlatma metinleri hazırlar."),
    ],
    collections: [
      {
        name: "Hastalar",
        description: "Kuruma kayıtlı hastalar ve iletişim bilgileri.",
        fields: [
          { key: "ad", label: "Ad Soyad", type: "text" },
          { key: "telefon", label: "Telefon", type: "text" },
          { key: "dogum", label: "Doğum tarihi", type: "date" },
          { key: "not", label: "Not", type: "longtext" },
        ],
      },
      {
        name: "Randevular",
        description: "Hasta randevuları. Hasta alanı Hastalar tablosundaki ad soyad ile eşleşir.",
        fields: [
          { key: "hasta", label: "Hasta", type: "text" },
          { key: "hekim", label: "Hekim", type: "text" },
          { key: "tarih", label: "Tarih ve saat", type: "text" },
          { key: "durum", label: "Durum", type: "select", options: ["Planlandı", "Geldi", "Gelmedi", "İptal"] },
        ],
      },
      {
        name: "Faturalar",
        description: "Kesilen faturalar ve ödeme durumları.",
        fields: [
          { key: "hasta", label: "Hasta", type: "text" },
          { key: "tutar", label: "Tutar (TL)", type: "number" },
          { key: "tarih", label: "Tarih", type: "date" },
          { key: "durum", label: "Durum", type: "select", options: ["Ödenmedi", "Ödendi", "Kısmi"] },
        ],
      },
    ],
  },
  {
    id: "retail",
    name: "Mağaza / perakende",
    kind: "Perakende",
    description: "Ürün ve stok takibi, siparişler, müşteriler.",
    bots: [
      lead("Teds", "Stok ve sipariş sorularında önce kayıtlara bak, tahmin yürütme."),
      bot("Stok", "📦", "Stok sorumlusu", "Ürün stoklarını takip eder. Stoğu kritik seviyenin altına düşen ürünleri bildirir."),
      bot("Satış", "🛒", "Sipariş ve müşteri", "Siparişleri kaydeder, durumlarını günceller, müşteri sorularına cevap taslakları hazırlar."),
    ],
    collections: [
      {
        name: "Ürünler",
        description: "Satılan ürünler, fiyatları ve stok miktarları.",
        fields: [
          { key: "ad", label: "Ürün", type: "text" },
          { key: "fiyat", label: "Fiyat (TL)", type: "number" },
          { key: "stok", label: "Stok", type: "number" },
          { key: "kritik", label: "Kritik seviye", type: "number" },
        ],
      },
      {
        name: "Siparişler",
        description: "Müşteri siparişleri.",
        fields: [
          { key: "musteri", label: "Müşteri", type: "text" },
          { key: "urunler", label: "Ürünler", type: "longtext" },
          { key: "tutar", label: "Tutar (TL)", type: "number" },
          { key: "durum", label: "Durum", type: "select", options: ["Yeni", "Hazırlanıyor", "Kargoda", "Teslim edildi", "İade"] },
        ],
      },
      {
        name: "Müşteriler",
        description: "Müşteri iletişim bilgileri.",
        fields: [
          { key: "ad", label: "Ad Soyad", type: "text" },
          { key: "telefon", label: "Telefon", type: "text" },
          { key: "eposta", label: "E-posta", type: "text" },
        ],
      },
    ],
  },
  {
    id: "realestate",
    name: "Emlak ofisi",
    kind: "Emlak",
    description: "Portföy, alıcı/kiracı adayları, gösterimler.",
    bots: [
      lead("Teds", ""),
      bot("Portföy", "🏠", "Portföy sorumlusu", "İlanları kaydeder ve günceller. Müşteri kriterlerine uyan ilanları bulur.", ["records", "memory", "screen"]),
      bot("Müşteri", "🤝", "Müşteri ilişkileri", "Aday müşterileri takip eder, gösterim planlar, takip mesajları hazırlar."),
    ],
    collections: [
      {
        name: "İlanlar",
        description: "Satılık ve kiralık gayrimenkuller.",
        fields: [
          { key: "baslik", label: "Başlık", type: "text" },
          { key: "tur", label: "Tür", type: "select", options: ["Satılık", "Kiralık"] },
          { key: "fiyat", label: "Fiyat (TL)", type: "number" },
          { key: "konum", label: "Konum", type: "text" },
          { key: "oda", label: "Oda sayısı", type: "text" },
        ],
      },
      {
        name: "Adaylar",
        description: "Alıcı ve kiracı adayları ile aradıkları özellikler.",
        fields: [
          { key: "ad", label: "Ad Soyad", type: "text" },
          { key: "telefon", label: "Telefon", type: "text" },
          { key: "kriter", label: "Aradığı", type: "longtext" },
          { key: "butce", label: "Bütçe (TL)", type: "number" },
        ],
      },
    ],
  },
  {
    id: "restaurant",
    name: "Restoran / kafe",
    kind: "Yeme-içme",
    description: "Rezervasyonlar, tedarikçiler, malzeme stoğu.",
    bots: [
      lead("Teds", ""),
      bot("Rezervasyon", "🍽️", "Rezervasyon sorumlusu", "Rezervasyonları alır ve kapasiteyi kontrol eder."),
      bot("Tedarik", "🥕", "Tedarik ve stok", "Malzeme stoğunu takip eder, eksikler için tedarikçi siparişi taslağı hazırlar."),
    ],
    collections: [
      {
        name: "Rezervasyonlar",
        description: "Masa rezervasyonları.",
        fields: [
          { key: "ad", label: "Ad", type: "text" },
          { key: "kisi", label: "Kişi", type: "number" },
          { key: "tarih", label: "Tarih ve saat", type: "text" },
          { key: "telefon", label: "Telefon", type: "text" },
        ],
      },
      {
        name: "Malzemeler",
        description: "Mutfak malzemeleri ve stok miktarları.",
        fields: [
          { key: "ad", label: "Malzeme", type: "text" },
          { key: "miktar", label: "Miktar", type: "number" },
          { key: "birim", label: "Birim", type: "text" },
          { key: "tedarikci", label: "Tedarikçi", type: "text" },
        ],
      },
    ],
  },
  {
    id: "office",
    name: "Genel ofis / KOBİ",
    kind: "Genel",
    description: "Müşteriler, işler/projeler, yapılacaklar. Her sektöre uyar.",
    bots: [
      lead("Teds", ""),
      bot("Araştırmacı", "🔎", "Araştırma", "İnternette araştırma yapar, şirket ve kişi bilgilerini derler, kaynaklarıyla özetler.", ["memory", "web", "screen"]),
      bot("Operasyon", "📋", "Operasyon", "İşleri ve yapılacakları takip eder, gecikenleri bildirir."),
    ],
    collections: [
      {
        name: "Müşteriler",
        description: "Müşteri ve firma bilgileri.",
        fields: [
          { key: "ad", label: "Ad / Firma", type: "text" },
          { key: "yetkili", label: "Yetkili", type: "text" },
          { key: "telefon", label: "Telefon", type: "text" },
          { key: "eposta", label: "E-posta", type: "text" },
        ],
      },
      {
        name: "İşler",
        description: "Yapılacak işler ve projeler.",
        fields: [
          { key: "baslik", label: "İş", type: "text" },
          { key: "sorumlu", label: "Sorumlu", type: "text" },
          { key: "bitis", label: "Bitiş", type: "date" },
          { key: "durum", label: "Durum", type: "select", options: ["Bekliyor", "Devam ediyor", "Bitti"] },
        ],
      },
    ],
  },
  {
    id: "blank",
    name: "Boş",
    kind: "Genel",
    description: "Sadece ana bot. Ekibi ve tabloları kendin kur.",
    bots: [lead("Teds", "")],
    collections: [],
  },
];

/** Şablonlar, seçili dilde. Türkçe kaynak metinler i18n sözlüğüyle çevrilir (alan anahtarları değişmez). */
export function templates(): Template[] {
  return TEMPLATES.map((x) => ({
    ...x,
    name: t(x.name),
    kind: t(x.kind),
    description: t(x.description),
    bots: x.bots.map((b) => ({ ...b, name: b.name === "Teds" ? b.name : t(b.name), role: t(b.role), instructions: leadText(b.instructions) })),
    collections: x.collections.map((c) => ({
      ...c,
      name: t(c.name),
      description: t(c.description),
      fields: c.fields.map((f) => ({ ...f, label: t(f.label), ...(f.options ? { options: f.options.map((o) => t(o)) } : {}) })),
    })),
  }));
}

/** Lider talimatı iki parçadan oluşur (ortak giriş + şablona özel ek); ikisi ayrı çevrilir. */
function leadText(s: string): string {
  if (!s.startsWith(LEAD_INTRO)) return t(s);
  const extra = s.slice(LEAD_INTRO.length);
  return [t(LEAD_INTRO.trim()), extra ? t(extra) : ""].filter(Boolean).join(" ");
}
