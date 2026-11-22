# Monitor terminów Lux Med — rozszerzenie Chrome

Rozszerzenie monitoruje otwartą przez użytkownika stronę Lux Med z wynikami
wyszukiwania terminów. Jeśli znajdzie komunikat `app-no-terms-info` albo
podany na stronie tekst o braku dostępnych terminów, oznacza, że terminów
brak. Jeśli wykryje stronę wyboru terminu bez tego komunikatu, odtwarza krótki
sygnał dźwiękowy. Rozszerzenie nie loguje użytkownika ani nie rezerwuje wizyt.

## Instalacja

1. Otwórz `chrome://extensions` w Chrome.
2. Włącz **Tryb dewelopera**.
3. Wybierz **Załaduj rozpakowane** i wskaż katalog tego projektu.
4. Zaloguj się do Lux Med i przejdź do wyników wyszukiwania terminów.
5. Kliknij ikonę rozszerzenia i wybierz **Włącz monitor**.

Po wykryciu braku terminów monitor czeka minutę, odświeża stronę i wznawia
wyszukiwanie ostatniej usługi. Cykl powtarza się, dopóki nadal nie ma terminów.
Po wykryciu dostępności odtwarza sygnał i zatrzymuje automatyczne odświeżanie.
Kartę można pozostawić w tle. Przy automatycznym odświeżeniu rozszerzenie
jednorazowo pomija ostrzeżenie `beforeunload`; ręczna nawigacja nadal zachowuje
ostrzeżenia strony.

## Wykrywanie terminów

Monitor odświeża kartę tylko po rozpoznaniu strony wyników wyszukiwania.
Rozpoznanie opiera się na elemencie `app-no-terms-info`, komunikacie o braku
terminów, tekście dotyczącym wyboru terminu lub adresie strony. Weryfikacja
dostępności wyników rozpoczyna się po wykryciu `div.card-body span` z tekstem
`x`; nie ma dodatkowego sekundowego oczekiwania przed sprawdzeniem komunikatu o
braku terminów. Jeśli Lux Med
zmieni strukturę strony lub komunikat, może być konieczna aktualizacja reguł w
`scripts/detector.js`. Jeśli po odświeżeniu pojawi się wybór usługi, monitor
klika pierwszy przycisk z ostatnio wyszukiwaną usługą w
`.recent-search-parameters-box`, a następnie widoczny, aktywny przycisk
`button[type="submit"].btn-search`. Jeśli przycisk jest wyłączony, monitor
sprawdza go ponownie co sekundę i klika, gdy stanie się aktywny.

Monitor działa tylko w domenie `luxmed.pl` i jej subdomenach.