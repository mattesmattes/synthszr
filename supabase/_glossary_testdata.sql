-- Testdaten fuer die Verifikation der Lexikonseiten (Task 6/7).
-- Zwei Begriffe, absichtlich ASYMMETRISCH verlinkt:
--   "Inferenz" erwaehnt "Mixture of Experts" im Text  -> relatedTerms + Mark im body
--   "Mixture of Experts" erwaehnt "Inferenz" NICHT     -> leerer Block, Komponente gibt null
-- Damit sind beide Faelle in einem Durchlauf pruefbar.
--
-- Entfernen mit:
--   delete from public.glossary_terms where slug in ('inferenz','mixture-of-experts');

insert into public.glossary_terms
  (slug, canonical_name, aliases, status, summary, body)
values
(
  'inferenz',
  'Inferenz',
  array['Inferenzkosten', 'Inference'],
  'published',
  'Inferenz ist der Moment, in dem ein trainiertes KI-Modell tatsaechlich arbeitet und eine Antwort erzeugt. Sie verursacht bei grossen Modellen den Grossteil der laufenden Kosten.',
  '{
    "type": "doc",
    "content": [
      {
        "type": "paragraph",
        "content": [
          {
            "type": "text",
            "text": "Ein KI-Modell durchlaeuft zwei sehr verschiedene Phasen. Beim Training lernt es aus Beispielen, was ueber Wochen laufen kann und einmal passiert. Bei der Inferenz benutzt man das fertige Modell: man stellt eine Frage, das Modell rechnet, eine Antwort kommt heraus. Das dauert Sekunden statt Wochen, passiert aber jedes Mal neu."
          }
        ]
      },
      {
        "type": "heading",
        "attrs": { "level": 2 },
        "content": [ { "type": "text", "text": "Warum das wichtig ist" } ]
      },
      {
        "type": "paragraph",
        "content": [
          {
            "type": "text",
            "text": "Training ist eine einmalige Investition, Inferenz eine Dauerbelastung. Wer einen Chatbot mit Millionen Nutzern betreibt, zahlt fuer jede einzelne Antwort. Deshalb dreht sich ein grosser Teil der Forschung nicht darum, Modelle klueger zu machen, sondern billiger im Betrieb."
          }
        ]
      },
      {
        "type": "heading",
        "attrs": { "level": 2 },
        "content": [ { "type": "text", "text": "Wie man sie guenstiger macht" } ]
      },
      {
        "type": "paragraph",
        "content": [
          {
            "type": "text",
            "text": "Der wirksamste Ansatz heisst Mixture of Experts: das Modell aktiviert pro Anfrage nur einen kleinen Teil seiner Bausteine statt alle. Ein Modell mit hunderten Milliarden Parametern rechnet dann so schnell wie ein viel kleineres, ohne an Faehigkeiten zu verlieren."
          }
        ]
      },
      {
        "type": "paragraph",
        "content": [
          {
            "type": "text",
            "text": "Daneben gibt es Verfahren, die Zahlen im Modell groeber speichern und dadurch Rechenzeit sparen. Beides zusammen hat die Inferenzkosten in den letzten Jahren deutlich gesenkt."
          }
        ]
      }
    ]
  }'::jsonb
),
(
  'mixture-of-experts',
  'Mixture of Experts',
  array['MoE', 'Mixture-of-Experts'],
  'published',
  'Mixture of Experts ist ein Bauprinzip fuer KI-Modelle, bei dem pro Anfrage nur ein Bruchteil der vorhandenen Bausteine rechnet. Das macht sehr grosse Modelle im Betrieb bezahlbar.',
  '{
    "type": "doc",
    "content": [
      {
        "type": "paragraph",
        "content": [
          {
            "type": "text",
            "text": "Stell dir eine Redaktion vor, in der zu jeder Frage alle hundert Mitarbeiter gleichzeitig recherchieren. Das waere gruendlich, aber absurd teuer. Sinnvoller ist es, pro Frage die zwei Leute zu fragen, die sich damit auskennen. Genau das macht ein Mixture-of-Experts-Modell."
          }
        ]
      },
      {
        "type": "heading",
        "attrs": { "level": 2 },
        "content": [ { "type": "text", "text": "Wie die Auswahl funktioniert" } ]
      },
      {
        "type": "paragraph",
        "content": [
          {
            "type": "text",
            "text": "Ein kleines Zusatznetz, der Router, entscheidet fuer jedes Wort, welche Experten zustaendig sind. Dieser Router wird mittrainiert, niemand teilt die Fachgebiete von Hand ein. Was ein Experte am Ende koennen wird, ergibt sich aus dem Training."
          }
        ]
      },
      {
        "type": "heading",
        "attrs": { "level": 2 },
        "content": [ { "type": "text", "text": "Der Haken" } ]
      },
      {
        "type": "paragraph",
        "content": [
          {
            "type": "text",
            "text": "Das ganze Modell muss trotzdem im Speicher liegen, auch die Experten, die gerade nichts tun. Man spart Rechenzeit, nicht Platz. Und wenn der Router schlecht verteilt, sind manche Experten ueberlastet und andere arbeitslos."
          }
        ]
      }
    ]
  }'::jsonb
);

-- Verifikation: muss 2 Zeilen liefern
select slug, canonical_name, status, length(summary) as summary_laenge
from public.glossary_terms
order by slug;
