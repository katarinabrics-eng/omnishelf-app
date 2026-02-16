# Deploy na Vercel – rychlý postup

## KRITICKÉ: Pokud na Vercelu vidíš 404

Soubory **index.html**, **app.html**, **login.html** musí být v **kořenu projektu** (ne v /dist ani /public).

1. **Vercel Dashboard** → tvůj projekt → **Settings** → **General**
   - **Root Directory:** nech PRÁZDNÉ (nebo `.`) – Vercel musí hledat soubory v kořenu repo
   - **Framework Preset:** Other
   - **Build Command:** prázdné (nebo smaž, pokud tam je něco)
   - **Output Directory:** prázdné nebo `.` – NIKDY `dist` ani `public` (tyto složky neexistují!)

2. **Settings** → **Git** – ověř, že je napojený správný repozitář a větev **main**.

3. Po změně nastavení: **Deployments** → **Redeploy** (nebo nový push).

## Co je v app.html (skutečný Omshelf)

- **Hlavní navigace:** Knihovna, Vitus, Šatník (Soon), Workshop (Soon), Pantry (Soon)
- **Moje knihovna:** Tvoje sbírka, Rozečteno, Půjčil/a jsem, Na prodej, Srdcovky, Přátelé doporučují
- **Tržiště:** sekce s kartami knih, štítky NOVINKA, 2+1, K zapůjčení, řádky Novinky v Tržišti, Bestseller, Co prodávám
- **Všechny cesty** k CSS, JS a obrázkům jsou **relativní** (`./`) pro Vercel

## Po úpravách – push na web

```bash
cd /Users/katarina/Documents/OmniShelf
git add .
git commit -m "fix: design Omshelf pro Vercel, relativní cesty, login/welcome"
git push origin main
```

Po pushi Vercel sám znovu nasadí (30–60 s). Na mobilu dej **Refresh** nebo otevři stránku znovu.

## Pokud vidíš jiný obsah (např. testovací ikony)

1. **Vercel Dashboard** → tvůj projekt → **Settings** → **General**
   - **Root Directory:** prázdné
   - **Output Directory:** prázdné
   - **Framework Preset:** Other
2. Ověř, že je napojený **správný repozitář** a větev **main**.
3. Otevři přímo: `https://tvoje-url.vercel.app/` (zelená LP) nebo `https://tvoje-url.vercel.app/app.html` (aplikace).
