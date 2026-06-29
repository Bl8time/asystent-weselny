require('dotenv').config();
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
app.use(express.json());

// Inicjalizacja baz i sztucznej inteligencji
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KLUCZ);
const genAI = new GoogleGenerativeAI(process.env.GEMINI_KLUCZ);

// Nasze tajne hasło do weryfikacji w Meta
const VERIFY_TOKEN = "wesele_moniki_2026";

// 1. OBOWIĄZKOWA WERYFIKACJA META (WhatsApp)
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode && token) {
    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      console.log('Webhook WhatsApp pomyślnie zweryfikowany!');
      res.status(200).send(challenge);
    } else {
      res.sendStatus(403);
    }
  } else {
    res.sendStatus(400);
  }
});

// 2. ODBIERANIE WIADOMOŚCI OD MONIKI
app.post('/webhook', async (req, res) => {
  try {
    const body = req.body;
    if (body.object) {
      if (body.entry && body.entry[0].changes && body.entry[0].changes[0].value.messages && body.entry[0].changes[0].value.messages[0]) {
        const msg = body.entry[0].changes[0].value.messages[0];
        const numerNadawcy = msg.from;
        const tekst = msg.text ? msg.text.body : null;

        if (tekst) {
          console.log(`Wiadomość od ${numerNadawcy}: ${tekst}`);
          przeanalizujIZapisz(tekst, numerNadawcy);
        }
      }
      res.sendStatus(200);
    } else {
      res.sendStatus(404);
    }
  } catch (err) {
    console.error('Błąd serwera:', err);
    res.sendStatus(500);
  }
});

// 3. WYSYŁANIE ODPOWIEDZI NA WHATSAPP
async function wyslijWhatsApp(doNumeru, tresc) {
  const url = `https://graph.facebook.com/v21.0/${process.env.WHATSAPP_ID_NUMERU}/messages`;
  try {
    await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.WHATSAPP_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: doNumeru,
        type: 'text',
        text: { body: tresc }
      })
    });
  } catch (e) {
    console.error('Błąd wysyłania wiadomości:', e);
  }
}

// 4. MÓZG ASYSTENTA (Analiza tekstu)
async function przeanalizujIZapisz(tekstMoniki, numerNadawcy) {
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    const prompt = `
Jesteś sympatycznym, super zorganizowanym wirtualnym asystentem planowania wesela Moniki i Michała. 
Przeanalizuj wiadomość od Moniki i sklasyfikuj ją do jednej z 3 tabel: "budzet", "zadania", "notatki".

Wiadomość: "${tekstMoniki}"

Zwróć TYLKO czysty obiekt JSON bez znaczników markdown (czyste klamry {}):
{
  "typ": "budzet",
  "dane": {
    "kategoria": "Sala" | "Kwiaty" | "Foto-Wideo" | "Muzyka" | "Ubiór" | "Inne",
    "usluga": "Krótka nazwa usługi",
    "koszt_calkowity": kwota_liczbowo_lub_0,
    "wplacona_zaliczka": kwota_liczbowo_lub_0,
    "uwagi": "opcjonalnie dodatkowe info"
  },
  "odpowiedz_dla_moniki": "Ciepłe, naturalne potwierdzenie dla Moniki na WhatsAppie, np. Zapisane! Dopisałam zaliczkę za DJ-a do naszego budżetu."
}

Zasady dla innych typów tabel:
- Jeśli to zadanie do zrobienia (np. "musimy zadzwonić do sali"): "typ": "zadania", dane w formacie: {"zadanie": "treść", "status": "Do zrobienia", "uwagi": "opcjonalnie"}
- Jeśli to luźna myśl/inspiracja: "typ": "notatki", dane w formacie: {"tresc": "treść notatki", "tagi": "np. sukienka, tort"}
`;

    const result = await model.generateContent(prompt);
    let czystyJson = result.response.text().trim();
    czystyJson = czystyJson.replace(/^```json/g, '').replace(/^```/g, '').replace(/```$/g, '').trim();

    const sparowane = JSON.parse(czystyJson);
    const tabela = sparowane.typ;
    const rekord = sparowane.dane;
    const odpowiedz = sparowane.odpowiedz_dla_moniki;

    const { error } = await supabase.from(tabela).insert([rekord]);

    if (!error) {
      await wyslijWhatsApp(numerNadawcy, odpowiedz);
      console.log(`Sukces! Zapisano w tabeli ${tabela}`);
    } else {
      console.error('Błąd bazy Supabase:', error);
      await wyslijWhatsApp(numerNadawcy, "Oj, wystąpił mały problem z zapisem do bazy danych. Spróbuj podyktować to jeszcze raz!");
    }
  } catch (err) {
    console.error('Błąd AI:', err);
    await wyslijWhatsApp(numerNadawcy, "Przepraszam, nie do końca zrozumiałam tę wiadomość. Czy możesz napisać to troszkę inaczej?");
  }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Serwer bota weselnego gotowy na porcie ${PORT}`);
});
