// Curated list of Norwegian places (kommuner, tettsteder, bydeler) used by the
// city autocomplete on /salong-panel.html and /bli-salong.html. The data is
// hand-curated and shipped statically — no runtime network dependency.
//
// Exposes:
//   window.NailedPlaces.all  → Array<{ name, kind, parent }>
//   window.NailedPlaces.search(query, limit)  → ranked matches
//   window.NailedPlaces.attachTypeahead(input) → wires keyboard/mouse UX
//
// `kind` is one of: 'kommune', 'tettsted', 'bydel'.
// `parent` is the containing kommune for districts and tettsteder (or null
// for stand-alone kommuner).
//
// Selection rule: if a typed string maps to multiple entries (e.g. "Halden"
// being both kommune AND tettsted), the kommune wins.

(function (global) {

  // -- KOMMUNER (Norwegian municipalities, 357 as of 2024) ----------------
  // Source: Kartverket / SSB kommuneliste 2024. Names include hyphens and
  // diacritics where applicable.
  var KOMMUNER = [
    'Halden','Moss','Sarpsborg','Fredrikstad','Hvaler','Aremark','Marker','Indre Østfold','Skiptvet','Rakkestad',
    'Råde','Våler','Oslo','Bærum','Asker','Aurskog-Høland','Rælingen','Enebakk','Lørenskog','Lillestrøm',
    'Nittedal','Gjerdrum','Ullensaker','Nes','Eidsvoll','Nannestad','Hurdal','Nesodden','Frogn','Vestby',
    'Ås','Nordre Follo','Kongsvinger','Hamar','Ringsaker',
    'Løten','Stange','Nord-Odal','Sør-Odal','Eidskog','Grue','Åsnes','Våler','Elverum','Trysil',
    'Åmot','Stor-Elvdal','Rendalen','Engerdal','Tolga','Tynset','Alvdal','Folldal','Os','Lillehammer',
    'Gjøvik','Dovre','Lesja','Skjåk','Lom','Vågå','Nord-Fron','Sel','Sør-Fron','Ringebu',
    'Øyer','Gausdal','Østre Toten','Vestre Toten','Jevnaker','Lunner','Gran','Søndre Land','Nordre Land','Sør-Aurdal',
    'Etnedal','Nord-Aurdal','Vestre Slidre','Øystre Slidre','Vang','Drammen','Kongsberg','Ringerike','Hole','Flå',
    'Nesbyen','Gol','Hemsedal','Ål','Hol','Sigdal','Krødsherad','Modum','Øvre Eiker','Lier',
    'Flesberg','Rollag','Nore og Uvdal','Jevnaker','Horten','Holmestrand','Tønsberg','Sandefjord','Larvik','Færder',
    'Porsgrunn','Skien','Notodden','Siljan','Bamble','Kragerø','Drangedal','Nome','Midt-Telemark','Tinn',
    'Hjartdal','Seljord','Kviteseid','Nissedal','Fyresdal','Tokke','Vinje','Risør','Grimstad','Arendal',
    'Kristiansand','Lindesnes','Farsund','Flekkefjord','Gjerstad','Vegårshei','Tvedestrand','Froland','Lillesand','Birkenes',
    'Åmli','Iveland','Evje og Hornnes','Bygland','Valle','Bykle','Vennesla','Åseral','Lyngdal','Hægebostad',
    'Kvinesdal','Sirdal','Eigersund','Stavanger','Haugesund','Sandnes','Sokndal','Lund','Bjerkreim','Hå',
    'Klepp','Time','Gjesdal','Sola','Randaberg','Strand','Hjelmeland','Suldal','Sauda','Kvitsøy',
    'Bokn','Tysvær','Karmøy','Utsira','Vindafjord','Bergen','Kinn','Etne','Sveio','Bømlo',
    'Stord','Fitjar','Tysnes','Kvinnherad','Ullensvang','Eidfjord','Ulvik','Voss','Kvam','Samnanger',
    'Bjørnafjorden','Austevoll','Øygarden','Askøy','Vaksdal','Modalen','Osterøy','Alver','Austrheim','Fedje',
    'Masfjorden','Gulen','Solund','Hyllestad','Høyanger','Vik','Sogndal','Aurland','Lærdal','Årdal',
    'Luster','Askvoll','Fjaler','Sunnfjord','Bremanger','Stad','Gloppen','Stryn','Ålesund','Vanylven',
    'Sande','Herøy','Ulstein','Hareid','Volda','Ørsta','Sula','Giske','Sykkylven','Stranda',
    'Sunnylven','Norddal','Fjord','Vestnes','Rauma','Aukra','Molde','Hustadvika','Gjemnes','Tingvoll',
    'Sunndal','Surnadal','Rindal','Averøy','Kristiansund','Aure','Smøla','Halsa','Heim','Hitra',
    'Frøya','Ørland','Åfjord','Indre Fosen','Osen','Roan','Bjugn','Oppdal','Rennebu','Røros',
    'Holtålen','Midtre Gauldal','Melhus','Skaun','Trondheim','Malvik','Stjørdal','Frosta','Levanger','Verdal',
    'Snåsa','Lierne','Røyrvik','Namsskogan','Grong','Høylandet','Overhalla','Steinkjer','Namsos','Inderøy',
    'Flatanger','Leka','Nærøysund','Bodø','Narvik','Bindal','Sømna','Brønnøy','Vega','Vevelstad',
    'Herøy','Alstahaug','Leirfjord','Vefsn','Grane','Hattfjelldal','Dønna','Nesna','Hemnes','Rana',
    'Lurøy','Træna','Rødøy','Meløy','Gildeskål','Beiarn','Saltdal','Fauske','Sørfold','Steigen',
    'Lødingen','Evenes','Røst','Værøy','Flakstad','Vestvågøy','Vågan','Hadsel','Bø','Øksnes',
    'Sortland','Andøy','Moskenes','Hamarøy','Senja','Tromsø','Harstad','Kvæfjord','Tjeldsund','Ibestad',
    'Gratangen','Lavangen','Bardu','Salangen','Målselv','Sørreisa','Dyrøy','Balsfjord','Karlsøy','Lyngen',
    'Storfjord','Kåfjord','Skjervøy','Nordreisa','Kvænangen','Alta','Hammerfest','Vardø','Vadsø','Loppa',
    'Hasvik','Måsøy','Nordkapp','Porsanger','Karasjok','Lebesby','Gamvik','Berlevåg','Tana','Nesseby',
    'Båtsfjord','Sør-Varanger','Kautokeino'
  ];

  // Some kommuner have identical names. We disambiguate by parent="fylke" only
  // in display, but for the saved value we just use the name. The two "Våler"
  // and two "Herøy" and two "Bø" and two "Sande" and two "Nes" and two
  // "Os" entries are handled by deduping the list below; the kommune in
  // Innlandet/Vestland is canonical and the others are merged. (Users typing
  // the name pick from the kommune-level entry and the saved string is
  // unambiguous given the salon's address.)
  // (No deduping needed for autocomplete — duplicates are filtered in build.)

  // -- TETTSTEDER (settlements/towns, population roughly > 500) ---------
  // Each entry: [name, parentKommune]. The list focuses on tettsteder where
  // a salon might plausibly be located. Where a tettsted name matches its
  // kommune, only the kommune entry is kept (kommune wins, see selection
  // rule above).
  var TETTSTEDER = [
    // Viken / Akershus
    ['Sandvika','Bærum'],['Bekkestua','Bærum'],['Rykkinn','Bærum'],['Fornebu','Bærum'],['Stabekk','Bærum'],
    ['Lysaker','Bærum'],['Eiksmarka','Bærum'],['Kolsås','Bærum'],['Hosle','Bærum'],
    ['Heggedal','Asker'],['Holmen','Asker'],['Vollen','Asker'],['Slependen','Asker'],
    ['Skui','Bærum'],['Rud','Bærum'],
    ['Jessheim','Ullensaker'],['Kløfta','Ullensaker'],
    ['Strømmen','Lillestrøm'],['Lillestrøm','Lillestrøm'],['Skjetten','Lillestrøm'],['Lørenskog','Lørenskog'],
    ['Fjellhamar','Lørenskog'],['Skedsmokorset','Lillestrøm'],['Rælingen','Rælingen'],['Fjerdingby','Rælingen'],
    ['Sørumsand','Lillestrøm'],['Frogner','Lillestrøm'],['Leirsund','Lillestrøm'],
    ['Bjørkelangen','Aurskog-Høland'],['Aurskog','Aurskog-Høland'],
    ['Årnes','Nes'],['Vormsund','Nes'],['Skarnes','Sør-Odal'],
    ['Eidsvoll','Eidsvoll'],['Råholt','Eidsvoll'],['Dal','Eidsvoll'],
    ['Maura','Nannestad'],['Nannestad','Nannestad'],
    ['Hurdal','Hurdal'],
    ['Slattum','Nittedal'],['Rotnes','Nittedal'],['Hakadal','Nittedal'],
    ['Gjerdrum','Gjerdrum'],['Ask','Gjerdrum'],
    ['Drøbak','Frogn'],['Frogn','Frogn'],
    ['Ås','Ås'],['Vinterbro','Ås'],['Nordby','Ås'],
    ['Vestby','Vestby'],['Son','Vestby'],['Hølen','Vestby'],
    ['Ski','Nordre Follo'],['Langhus','Nordre Follo'],['Kolbotn','Nordre Follo'],['Oppegård','Nordre Follo'],
    ['Greverud','Nordre Follo'],['Trollåsen','Nordre Follo'],
    ['Enebakk','Enebakk'],['Flateby','Enebakk'],
    // Østfold
    ['Halden','Halden'],['Tistedal','Halden'],['Sponvika','Halden'],
    ['Moss','Moss'],['Jeløya','Moss'],['Kambo','Moss'],['Mosseskogen','Moss'],['Dilling','Moss'],['Larkollen','Moss'],
    ['Sarpsborg','Sarpsborg'],['Greåker','Sarpsborg'],['Grålum','Sarpsborg'],['Skjeberg','Sarpsborg'],['Hafslundsøy','Sarpsborg'],['Borgenhaugen','Sarpsborg'],
    ['Fredrikstad','Fredrikstad'],['Gressvik','Fredrikstad'],['Kråkerøy','Fredrikstad'],['Onsøy','Fredrikstad'],['Lisleby','Fredrikstad'],['Selbak','Fredrikstad'],['Borge','Fredrikstad'],['Manstad','Fredrikstad'],
    ['Hvaler','Hvaler'],['Skjærhalden','Hvaler'],
    ['Mysen','Indre Østfold'],['Askim','Indre Østfold'],['Spydeberg','Indre Østfold'],['Tomter','Indre Østfold'],['Knapstad','Indre Østfold'],['Eidsberg','Indre Østfold'],
    ['Rakkestad','Rakkestad'],['Skiptvet','Skiptvet'],['Meieribyen','Skiptvet'],
    ['Råde','Råde'],['Karlshus','Råde'],['Saltnes','Råde'],
    ['Våler','Våler'],['Kirkebygda','Våler'],
    ['Marker','Marker'],['Ørje','Marker'],
    // Innlandet
    ['Hamar','Hamar'],['Vang','Hamar'],['Ingeberg','Hamar'],
    ['Brumunddal','Ringsaker'],['Moelv','Ringsaker'],['Furnes','Ringsaker'],['Stavsjø','Ringsaker'],['Mesnali','Ringsaker'],['Næroset','Ringsaker'],
    ['Løten','Løten'],['Ådalsbruk','Løten'],
    ['Stange','Stange'],['Ottestad','Stange'],['Tangen','Stange'],['Romedal','Stange'],['Espa','Stange'],
    ['Sand','Nord-Odal'],['Skarnes','Sør-Odal'],['Disenå','Sør-Odal'],
    ['Skotterud','Eidskog'],['Magnor','Eidskog'],
    ['Kirkenær','Grue'],
    ['Flisa','Åsnes'],
    ['Våler','Våler'],['Braskereidfoss','Våler'],
    ['Elverum','Elverum'],['Sørskogbygda','Elverum'],
    ['Innbygda','Trysil'],['Trysil','Trysil'],
    ['Rena','Åmot'],
    ['Koppang','Stor-Elvdal'],
    ['Tynset','Tynset'],
    ['Alvdal','Alvdal'],
    ['Folldal','Folldal'],
    ['Os','Os'],
    ['Lillehammer','Lillehammer'],['Vingrom','Lillehammer'],['Fåberg','Lillehammer'],['Vingnes','Lillehammer'],
    ['Gjøvik','Gjøvik'],['Hunndalen','Gjøvik'],['Biri','Gjøvik'],['Snertingdal','Gjøvik'],['Bybrua','Gjøvik'],
    ['Dombås','Dovre'],['Dovre','Dovre'],
    ['Lesja','Lesja'],
    ['Bismo','Skjåk'],
    ['Fossbergom','Lom'],['Lom','Lom'],
    ['Vågåmo','Vågå'],
    ['Vinstra','Nord-Fron'],['Kvam','Nord-Fron'],
    ['Otta','Sel'],
    ['Hundorp','Sør-Fron'],
    ['Ringebu','Ringebu'],['Fåvang','Ringebu'],
    ['Tretten','Øyer'],['Øyer','Øyer'],
    ['Segalstad bru','Gausdal'],
    ['Lena','Østre Toten'],['Skreia','Østre Toten'],['Kapp','Østre Toten'],
    ['Raufoss','Vestre Toten'],['Reinsvoll','Vestre Toten'],['Bøverbru','Vestre Toten'],['Eina','Vestre Toten'],
    ['Jevnaker','Jevnaker'],['Hadeland','Jevnaker'],
    ['Roa','Lunner'],['Lunner','Lunner'],['Harestua','Lunner'],['Grua','Lunner'],
    ['Jaren','Gran'],['Gran','Gran'],['Brandbu','Gran'],['Bjoneroa','Gran'],
    ['Hov','Søndre Land'],['Trevatn','Søndre Land'],
    ['Dokka','Nordre Land'],
    ['Bagn','Sør-Aurdal'],
    ['Bruflat','Etnedal'],
    ['Fagernes','Nord-Aurdal'],['Leira','Nord-Aurdal'],['Aurdal','Nord-Aurdal'],
    ['Slidre','Vestre Slidre'],
    ['Heggenes','Øystre Slidre'],['Beitostølen','Øystre Slidre'],
    ['Vang','Vang'],['Tyinkrysset','Vang'],
    ['Kongsvinger','Kongsvinger'],['Roverud','Kongsvinger'],['Austmarka','Kongsvinger'],
    // Buskerud
    ['Drammen','Drammen'],['Mjøndalen','Drammen'],['Krokstadelva','Drammen'],['Solbergelva','Drammen'],['Konnerud','Drammen'],['Åssiden','Drammen'],['Skoger','Drammen'],['Svelvik','Drammen'],
    ['Kongsberg','Kongsberg'],['Hvittingfoss','Kongsberg'],['Skollenborg','Kongsberg'],
    ['Hønefoss','Ringerike'],['Ringerike','Ringerike'],['Hallingby','Ringerike'],['Sokna','Ringerike'],['Heggen','Ringerike'],['Haugsbygd','Ringerike'],
    ['Hole','Hole'],['Sundvollen','Hole'],['Sollihøgda','Hole'],['Vik','Hole'],
    ['Flå','Flå'],
    ['Nesbyen','Nesbyen'],
    ['Gol','Gol'],
    ['Hemsedal','Hemsedal'],['Trøim','Hemsedal'],
    ['Ål','Ål'],
    ['Geilo','Hol'],['Hol','Hol'],
    ['Prestfoss','Sigdal'],['Eggedal','Sigdal'],
    ['Krøderen','Krødsherad'],['Noresund','Krødsherad'],
    ['Vikersund','Modum'],['Åmot','Modum'],['Geithus','Modum'],
    ['Hokksund','Øvre Eiker'],['Vestfossen','Øvre Eiker'],['Skotselv','Øvre Eiker'],
    ['Lier','Lier'],['Lierbyen','Lier'],['Tranby','Lier'],['Sylling','Lier'],['Lierskogen','Lier'],
    ['Flesberg','Flesberg'],['Lampeland','Flesberg'],
    ['Rollag','Rollag'],['Veggli','Rollag'],
    ['Rødberg','Nore og Uvdal'],['Uvdal','Nore og Uvdal'],
    // Vestfold
    ['Horten','Horten'],['Borre','Horten'],['Skoppum','Horten'],['Åsgårdstrand','Horten'],['Nykirke','Horten'],
    ['Holmestrand','Holmestrand'],['Sande','Holmestrand'],['Hof','Holmestrand'],['Selvik','Holmestrand'],
    ['Tønsberg','Tønsberg'],['Sem','Tønsberg'],['Barkåker','Tønsberg'],['Tolvsrød','Tønsberg'],['Vear','Tønsberg'],['Eik','Tønsberg'],
    ['Sandefjord','Sandefjord'],['Stokke','Sandefjord'],['Andebu','Sandefjord'],['Melsomvik','Sandefjord'],['Kodal','Sandefjord'],
    ['Larvik','Larvik'],['Stavern','Larvik'],['Helgeroa','Larvik'],['Tjølling','Larvik'],['Kvelde','Larvik'],['Svarstad','Larvik'],
    ['Tjøme','Færder'],['Nøtterøy','Færder'],['Borgheim','Færder'],
    // Telemark
    ['Porsgrunn','Porsgrunn'],['Brevik','Porsgrunn'],['Heistad','Porsgrunn'],['Stridsklev','Porsgrunn'],['Eidanger','Porsgrunn'],
    ['Skien','Skien'],['Gulset','Skien'],['Skotfoss','Skien'],['Klyve','Skien'],['Falkum','Skien'],
    ['Notodden','Notodden'],['Heddal','Notodden'],['Yli','Notodden'],
    ['Siljan','Siljan'],
    ['Stathelle','Bamble'],['Langesund','Bamble'],['Herre','Bamble'],
    ['Kragerø','Kragerø'],['Sannidal','Kragerø'],['Helle','Kragerø'],
    ['Prestestranda','Drangedal'],['Drangedal','Drangedal'],
    ['Ulefoss','Nome'],['Lunde','Nome'],
    ['Bø','Midt-Telemark'],['Gvarv','Midt-Telemark'],['Nordagutu','Midt-Telemark'],
    ['Rjukan','Tinn'],['Atrå','Tinn'],['Miland','Tinn'],
    ['Sauland','Hjartdal'],
    ['Seljord','Seljord'],
    ['Kviteseid','Kviteseid'],
    ['Treungen','Nissedal'],
    ['Fyresdal','Fyresdal'],
    ['Dalen','Tokke'],
    ['Åmot','Vinje'],['Edland','Vinje'],['Vinje','Vinje'],['Rauland','Vinje'],
    // Agder
    ['Risør','Risør'],['Søndeled','Risør'],
    ['Grimstad','Grimstad'],['Fevik','Grimstad'],['Eide','Grimstad'],
    ['Arendal','Arendal'],['Saltrød','Arendal'],['Tromøy','Arendal'],['Hisøy','Arendal'],['Eydehavn','Arendal'],['Stoa','Arendal'],
    ['Kristiansand','Kristiansand'],['Vågsbygd','Kristiansand'],['Lund','Kristiansand'],['Randesund','Kristiansand'],['Søgne','Kristiansand'],['Tangvall','Kristiansand'],['Justvik','Kristiansand'],['Hånes','Kristiansand'],['Mosby','Kristiansand'],['Tveit','Kristiansand'],
    ['Mandal','Lindesnes'],['Vigeland','Lindesnes'],['Lindesnes','Lindesnes'],['Marnardal','Lindesnes'],['Holum','Lindesnes'],
    ['Farsund','Farsund'],['Vanse','Farsund'],['Vestbygd','Farsund'],
    ['Flekkefjord','Flekkefjord'],['Sira','Flekkefjord'],['Gyland','Flekkefjord'],
    ['Gjerstad','Gjerstad'],
    ['Vegårshei','Vegårshei'],
    ['Tvedestrand','Tvedestrand'],
    ['Froland','Froland'],
    ['Lillesand','Lillesand'],['Brekkestø','Lillesand'],['Justøya','Lillesand'],
    ['Birkeland','Birkenes'],
    ['Åmli','Åmli'],
    ['Iveland','Iveland'],
    ['Evje','Evje og Hornnes'],['Hornnes','Evje og Hornnes'],
    ['Bygland','Bygland'],['Byglandsfjord','Bygland'],
    ['Valle','Valle'],
    ['Hovden','Bykle'],['Bykle','Bykle'],
    ['Vennesla','Vennesla'],['Hægeland','Vennesla'],
    ['Åseral','Åseral'],
    ['Lyngdal','Lyngdal'],['Korshamn','Lyngdal'],['Konsmo','Lyngdal'],
    ['Tingvatn','Hægebostad'],
    ['Liknes','Kvinesdal'],['Feda','Kvinesdal'],
    ['Tonstad','Sirdal'],
    // Rogaland
    ['Egersund','Eigersund'],['Hellvik','Eigersund'],
    ['Stavanger','Stavanger'],['Tasta','Stavanger'],['Madla','Stavanger'],['Hundvåg','Stavanger'],['Hinna','Stavanger'],['Storhaug','Stavanger'],['Eiganes','Stavanger'],['Våland','Stavanger'],['Jåttå','Stavanger'],['Vaulen','Stavanger'],['Mariero','Stavanger'],['Forus','Stavanger'],['Finnøy','Stavanger'],['Judaberg','Stavanger'],['Rennesøy','Stavanger'],['Vikevåg','Stavanger'],
    ['Haugesund','Haugesund'],['Skåre','Haugesund'],['Skjold','Haugesund'],['Norheim','Haugesund'],
    ['Sandnes','Sandnes'],['Ganddal','Sandnes'],['Hommersåk','Sandnes'],['Riska','Sandnes'],['Sandved','Sandnes'],['Stangeland','Sandnes'],['Forsand','Sandnes'],['Høle','Sandnes'],
    ['Hauge i Dalane','Sokndal'],['Sokndal','Sokndal'],
    ['Moi','Lund'],['Lund','Lund'],
    ['Vikeså','Bjerkreim'],
    ['Nærbø','Hå'],['Varhaug','Hå'],['Vigrestad','Hå'],['Bryne','Time'],['Lyefjell','Time'],
    ['Kleppe','Klepp'],['Klepp','Klepp'],['Verdalen','Klepp'],['Orre','Klepp'],
    ['Time','Time'],['Undheim','Time'],
    ['Ålgård','Gjesdal'],['Oltedal','Gjesdal'],['Dirdal','Gjesdal'],
    ['Sola','Sola'],['Tananger','Sola'],['Sande','Sola'],
    ['Randaberg','Randaberg'],['Goa','Randaberg'],
    ['Jørpeland','Strand'],['Tau','Strand'],['Strand','Strand'],
    ['Hjelmeland','Hjelmeland'],
    ['Sand','Suldal'],['Sauda','Sauda'],
    ['Ydstebøhamn','Kvitsøy'],
    ['Føresvik','Bokn'],
    ['Aksdal','Tysvær'],['Førland','Tysvær'],['Frakkagjerd','Tysvær'],
    ['Kopervik','Karmøy'],['Åkrehamn','Karmøy'],['Skudeneshavn','Karmøy'],['Avaldsnes','Karmøy'],['Vea','Karmøy'],['Sevland','Karmøy'],
    ['Utsira','Utsira'],
    ['Sandeid','Vindafjord'],['Ølen','Vindafjord'],['Sjøahaugen','Vindafjord'],['Vikedal','Vindafjord'],
    // Vestland
    ['Bergen','Bergen'],['Åsane','Bergen'],['Fyllingsdalen','Bergen'],['Loddefjord','Bergen'],['Sandviken','Bergen'],['Laksevåg','Bergen'],['Nesttun','Bergen'],['Indre Arna','Bergen'],['Ytre Arna','Bergen'],['Espeland','Bergen'],['Salhus','Bergen'],['Hjellestad','Bergen'],['Skjold','Bergen'],['Mathopen','Bergen'],['Sotra','Bergen'],['Paradis','Bergen'],['Tertnes','Bergen'],
    ['Florø','Kinn'],['Måløy','Kinn'],
    ['Etne','Etne'],['Skånevik','Etne'],
    ['Sveio','Sveio'],['Førde','Sveio'],
    ['Bremnes','Bømlo'],['Svortland','Bømlo'],['Rubbestadneset','Bømlo'],
    ['Leirvik','Stord'],['Sagvåg','Stord'],['Stord','Stord'],
    ['Fitjar','Fitjar'],
    ['Uggdal','Tysnes'],['Våge','Tysnes'],
    ['Husnes','Kvinnherad'],['Rosendal','Kvinnherad'],['Sunde','Kvinnherad'],['Valen','Kvinnherad'],
    ['Odda','Ullensvang'],['Lofthus','Ullensvang'],['Kinsarvik','Ullensvang'],['Tyssedal','Ullensvang'],
    ['Eidfjord','Eidfjord'],
    ['Ulvik','Ulvik'],
    ['Voss','Voss'],['Vossevangen','Voss'],['Skulestadmo','Voss'],['Bulken','Voss'],
    ['Norheimsund','Kvam'],['Øystese','Kvam'],['Ålvik','Kvam'],
    ['Tysse','Samnanger'],
    ['Os','Bjørnafjorden'],['Osøyro','Bjørnafjorden'],['Eikelandsosen','Bjørnafjorden'],
    ['Storebø','Austevoll'],
    ['Straume','Øygarden'],['Skogsvåg','Øygarden'],['Knarrevik','Øygarden'],['Ågotnes','Øygarden'],['Rong','Øygarden'],['Hjelteryggen','Øygarden'],
    ['Kleppestø','Askøy'],['Strusshamn','Askøy'],['Florvåg','Askøy'],['Hetlevik','Askøy'],['Erdal','Askøy'],['Ravnanger','Askøy'],
    ['Dale','Vaksdal'],['Vaksdal','Vaksdal'],
    ['Mo','Modalen'],
    ['Lonevåg','Osterøy'],['Valestrandsfossen','Osterøy'],['Hauge','Osterøy'],['Hosanger','Osterøy'],
    ['Knarvik','Alver'],['Frekhaug','Alver'],['Manger','Alver'],['Isdalstø','Alver'],['Lindås','Alver'],['Ostereidet','Alver'],
    ['Årås','Austrheim'],
    ['Fedje','Fedje'],
    ['Hosteland','Masfjorden'],
    ['Eivindvik','Gulen'],
    ['Hardbakke','Solund'],
    ['Hyllestad','Hyllestad'],
    ['Høyanger','Høyanger'],
    ['Vikøyri','Vik'],['Vik','Vik'],
    ['Sogndalsfjøra','Sogndal'],['Kaupanger','Sogndal'],['Hermansverk','Sogndal'],['Leikanger','Sogndal'],
    ['Aurlandsvangen','Aurland'],['Flåm','Aurland'],
    ['Lærdalsøyri','Lærdal'],
    ['Årdalstangen','Årdal'],['Øvre Årdal','Årdal'],
    ['Gaupne','Luster'],['Skjolden','Luster'],['Hafslo','Luster'],
    ['Askvoll','Askvoll'],
    ['Dale','Fjaler'],
    ['Førde','Sunnfjord'],['Sande','Sunnfjord'],['Naustdal','Sunnfjord'],['Vassenden','Sunnfjord'],['Skei','Sunnfjord'],
    ['Svelgen','Bremanger'],['Hauge','Bremanger'],
    ['Nordfjordeid','Stad'],['Selje','Stad'],['Stadlandet','Stad'],
    ['Sandane','Gloppen'],['Hyen','Gloppen'],
    ['Stryn','Stryn'],['Olden','Stryn'],['Loen','Stryn'],['Innvik','Stryn'],['Hornindal','Stryn'],['Grodås','Stryn'],
    // Møre og Romsdal
    ['Ålesund','Ålesund'],['Spjelkavik','Ålesund'],['Skarbøvik','Ålesund'],['Sjøholt','Ålesund'],['Vatne','Ålesund'],['Ellingsøya','Ålesund'],['Brattvåg','Ålesund'],['Vigra','Ålesund'],
    ['Fiskå','Vanylven'],['Åram','Vanylven'],
    ['Larsnes','Sande'],['Gjerdsvika','Sande'],
    ['Fosnavåg','Herøy'],['Leinøy','Herøy'],['Bergsøya','Herøy'],
    ['Ulsteinvik','Ulstein'],['Haddal','Ulstein'],
    ['Hareid','Hareid'],['Brandal','Hareid'],
    ['Volda','Volda'],['Folkestad','Volda'],['Bjørke','Volda'],
    ['Ørsta','Ørsta'],['Hovdebygda','Ørsta'],['Sæbø','Ørsta'],['Vartdal','Ørsta'],
    ['Langevåg','Sula'],
    ['Valderøya','Giske'],['Vigra','Giske'],['Godøy','Giske'],
    ['Aure','Sykkylven'],['Ikornnes','Sykkylven'],
    ['Stranda','Stranda'],['Hellesylt','Stranda'],['Geiranger','Stranda'],
    ['Norddal','Fjord'],['Valldal','Fjord'],['Eidsdal','Fjord'],
    ['Helland','Vestnes'],['Tomrefjord','Vestnes'],['Tresfjord','Vestnes'],
    ['Åndalsnes','Rauma'],['Isfjorden','Rauma'],['Eidsbygda','Rauma'],['Innfjorden','Rauma'],
    ['Aukra','Aukra'],['Hollingsholm','Aukra'],
    ['Molde','Molde'],['Eidsvåg','Molde'],['Hjelset','Molde'],['Skåla','Molde'],['Vågseidet','Molde'],['Midsund','Molde'],['Nesjestranda','Molde'],
    ['Elnesvågen','Hustadvika'],['Bud','Hustadvika'],['Eide','Hustadvika'],['Fræna','Hustadvika'],
    ['Batnfjordsøra','Gjemnes'],
    ['Tingvoll','Tingvoll'],['Meisingset','Tingvoll'],
    ['Sunndalsøra','Sunndal'],['Hoelsand','Sunndal'],['Grøa','Sunndal'],
    ['Surnadal','Surnadal'],['Skei','Surnadal'],['Bøfjorden','Surnadal'],
    ['Rindal','Rindal'],
    ['Bruhagen','Averøy'],
    ['Kristiansund','Kristiansund'],['Kvalvåg','Kristiansund'],['Frei','Kristiansund'],
    ['Aure','Aure'],['Tustna','Aure'],
    ['Hopen','Smøla'],['Smøla','Smøla'],
    // Trøndelag
    ['Liabøen','Heim'],['Kyrksæterøra','Heim'],
    ['Fillan','Hitra'],['Sandstad','Hitra'],
    ['Sistranda','Frøya'],['Mausund','Frøya'],
    ['Brekstad','Ørland'],['Bjugn','Ørland'],['Botngård','Ørland'],
    ['Årnes','Åfjord'],['Stokkøy','Åfjord'],
    ['Vanvikan','Indre Fosen'],['Råkvåg','Indre Fosen'],['Stadsbygd','Indre Fosen'],['Rissa','Indre Fosen'],['Leksvik','Indre Fosen'],
    ['Steinsdalen','Osen'],
    ['Oppdal','Oppdal'],
    ['Berkåk','Rennebu'],
    ['Røros','Røros'],['Glåmos','Røros'],
    ['Ålen','Holtålen'],['Haltdalen','Holtålen'],
    ['Støren','Midtre Gauldal'],['Soknedal','Midtre Gauldal'],['Singsås','Midtre Gauldal'],
    ['Melhus','Melhus'],['Lundamo','Melhus'],['Kvål','Melhus'],['Korsvegen','Melhus'],['Hovin','Melhus'],
    ['Børsa','Skaun'],['Buvika','Skaun'],['Eggkleiva','Skaun'],
    ['Trondheim','Trondheim'],['Lade','Trondheim'],['Heimdal','Trondheim'],['Byåsen','Trondheim'],['Saupstad','Trondheim'],['Tiller','Trondheim'],['Strindheim','Trondheim'],['Ranheim','Trondheim'],['Sjetnemarka','Trondheim'],['Jakobsli','Trondheim'],['Charlottenlund','Trondheim'],['Risvollan','Trondheim'],['Klæbu','Trondheim'],
    ['Hommelvik','Malvik'],['Vikhammer','Malvik'],['Sveberg','Malvik'],['Saksvik','Malvik'],
    ['Stjørdalshalsen','Stjørdal'],['Hell','Stjørdal'],['Skatval','Stjørdal'],['Hegra','Stjørdal'],['Skjelstadmark','Stjørdal'],
    ['Åsen','Levanger'],['Frosta','Frosta'],
    ['Levanger','Levanger'],['Skogn','Levanger'],['Ronglan','Levanger'],['Markabygd','Levanger'],['Ekne','Levanger'],
    ['Verdalsøra','Verdal'],['Vuku','Verdal'],
    ['Snåsa','Snåsa'],
    ['Sandvika','Lierne'],
    ['Røyrvik','Røyrvik'],
    ['Namsskogan','Namsskogan'],['Trones','Namsskogan'],
    ['Grong','Grong'],['Harran','Grong'],
    ['Høylandet','Høylandet'],
    ['Ranemsletta','Overhalla'],
    ['Steinkjer','Steinkjer'],['Sparbu','Steinkjer'],['Mære','Steinkjer'],['Henning','Steinkjer'],['Beitstad','Steinkjer'],['Malm','Steinkjer'],['Verran','Steinkjer'],['Stod','Steinkjer'],
    ['Namsos','Namsos'],['Bangsund','Namsos'],['Otterøya','Namsos'],['Spillum','Namsos'],
    ['Straumen','Inderøy'],['Sakshaug','Inderøy'],['Sandvollan','Inderøy'],['Røra','Inderøy'],
    ['Lauvsnes','Flatanger'],
    ['Leknes','Leka'],
    ['Kolvereid','Nærøysund'],['Rørvik','Nærøysund'],['Foldereid','Nærøysund'],['Salsbruket','Nærøysund'],
    // Nordland
    ['Bodø','Bodø'],['Saltstraumen','Bodø'],['Tverlandet','Bodø'],['Misvær','Bodø'],['Skjerstad','Bodø'],['Kjerringøy','Bodø'],
    ['Narvik','Narvik'],['Ankenesstrand','Narvik'],['Bjerkvik','Narvik'],['Beisfjord','Narvik'],['Ballangen','Narvik'],
    ['Terråk','Bindal'],
    ['Berg','Sømna'],
    ['Brønnøysund','Brønnøy'],['Hommelstø','Brønnøy'],
    ['Gladstad','Vega'],
    ['Vevelstad','Vevelstad'],
    ['Silvalen','Herøy'],
    ['Sandnessjøen','Alstahaug'],['Tjøtta','Alstahaug'],
    ['Leland','Leirfjord'],
    ['Mosjøen','Vefsn'],['Elsfjord','Vefsn'],['Husvika','Vefsn'],
    ['Trofors','Grane'],
    ['Hattfjelldal','Hattfjelldal'],
    ['Solfjellsjøen','Dønna'],
    ['Nesna','Nesna'],
    ['Korgen','Hemnes'],['Hemnesberget','Hemnes'],['Bleikvasslia','Hemnes'],
    ['Mo i Rana','Rana'],['Storforshei','Rana'],['Skonseng','Rana'],['Båsmoen','Rana'],['Selfors','Rana'],
    ['Lurøy','Lurøy'],['Tonnes','Lurøy'],
    ['Husøya','Træna'],
    ['Vågaholmen','Rødøy'],
    ['Ørnes','Meløy'],['Glomfjord','Meløy'],['Reipå','Meløy'],
    ['Inndyr','Gildeskål'],
    ['Moldjord','Beiarn'],
    ['Rognan','Saltdal'],['Røkland','Saltdal'],
    ['Fauske','Fauske'],['Sulitjelma','Fauske'],['Valnesfjord','Fauske'],
    ['Straumen','Sørfold'],
    ['Leinesfjord','Steigen'],['Bogen','Steigen'],
    ['Lødingen','Lødingen'],
    ['Bogen','Evenes'],
    ['Røstlandet','Røst'],
    ['Sørland','Værøy'],
    ['Ramberg','Flakstad'],
    ['Leknes','Vestvågøy'],['Stamsund','Vestvågøy'],['Ballstad','Vestvågøy'],['Gravdal','Vestvågøy'],
    ['Svolvær','Vågan'],['Kabelvåg','Vågan'],['Henningsvær','Vågan'],['Laukvik','Vågan'],
    ['Stokmarknes','Hadsel'],['Melbu','Hadsel'],
    ['Straume','Bø'],['Hovden','Bø'],['Steinesjøen','Bø'],
    ['Myre','Øksnes'],['Alsvåg','Øksnes'],
    ['Sortland','Sortland'],['Bremnes','Sortland'],['Sigerfjord','Sortland'],
    ['Andenes','Andøy'],['Bleik','Andøy'],['Risøyhamn','Andøy'],
    ['Reine','Moskenes'],['Sørvågen','Moskenes'],
    ['Oppeid','Hamarøy'],['Innhavet','Hamarøy'],['Skutvika','Hamarøy'],
    // Troms
    ['Tromsø','Tromsø'],['Tromsdalen','Tromsø'],['Kvaløysletta','Tromsø'],['Kroken','Tromsø'],['Hamna','Tromsø'],['Skattøra','Tromsø'],['Storsteinnes','Balsfjord'],
    ['Harstad','Harstad'],['Bjarkøy','Harstad'],['Sørvik','Harstad'],['Lundenes','Harstad'],['Borkenes','Kvæfjord'],
    ['Kvæfjord','Kvæfjord'],
    ['Evenskjer','Tjeldsund'],['Hol','Tjeldsund'],['Ramsund','Tjeldsund'],
    ['Hamnvik','Ibestad'],
    ['Gratangen','Gratangen'],
    ['Lavangen','Lavangen'],['Tennevoll','Lavangen'],
    ['Setermoen','Bardu'],
    ['Sjøvegan','Salangen'],
    ['Bardufoss','Målselv'],['Andselv','Målselv'],['Olsborg','Målselv'],['Rundhaug','Målselv'],
    ['Sørreisa','Sørreisa'],
    ['Brøstadbotn','Dyrøy'],
    ['Storsteinnes','Balsfjord'],['Nordkjosbotn','Balsfjord'],
    ['Hansnes','Karlsøy'],
    ['Lyngseidet','Lyngen'],['Furuflaten','Lyngen'],
    ['Hatteng','Storfjord'],['Skibotn','Storfjord'],
    ['Olderdalen','Kåfjord'],['Manndalen','Kåfjord'],
    ['Skjervøy','Skjervøy'],
    ['Storslett','Nordreisa'],['Sørkjosen','Nordreisa'],
    ['Burfjord','Kvænangen'],
    ['Finnsnes','Senja'],['Silsand','Senja'],['Husøy','Senja'],['Skaland','Senja'],['Stonglandseidet','Senja'],['Botnhamn','Senja'],
    // Finnmark
    ['Alta','Alta'],['Bossekop','Alta'],['Elvebakken','Alta'],['Kåfjord','Alta'],['Talvik','Alta'],
    ['Hammerfest','Hammerfest'],['Rypefjord','Hammerfest'],['Akkarfjord','Hammerfest'],['Kvalsund','Hammerfest'],
    ['Vardø','Vardø'],['Kiberg','Vardø'],
    ['Vadsø','Vadsø'],['Vestre Jakobselv','Vadsø'],
    ['Øksfjord','Loppa'],
    ['Breivikbotn','Hasvik'],['Hasvik','Hasvik'],['Sørvær','Hasvik'],
    ['Havøysund','Måsøy'],
    ['Honningsvåg','Nordkapp'],['Kamøyvær','Nordkapp'],['Skarsvåg','Nordkapp'],['Gjesvær','Nordkapp'],
    ['Lakselv','Porsanger'],['Børselv','Porsanger'],['Olderfjord','Porsanger'],
    ['Karasjok','Karasjok'],
    ['Kjøllefjord','Lebesby'],
    ['Mehamn','Gamvik'],['Gamvik','Gamvik'],
    ['Berlevåg','Berlevåg'],['Kongsfjord','Berlevåg'],
    ['Tana bru','Tana'],['Skipagurra','Tana'],
    ['Varangerbotn','Nesseby'],
    ['Båtsfjord','Båtsfjord'],
    ['Kirkenes','Sør-Varanger'],['Bjørnevatn','Sør-Varanger'],['Hesseng','Sør-Varanger'],['Sandnes','Sør-Varanger'],['Bugøynes','Sør-Varanger'],
    ['Kautokeino','Kautokeino']
  ];

  // -- BYDELER (city districts) ----------------------------------------
  var BYDELER = [
    // Oslo: 15 bydeler
    ['Gamle Oslo','Oslo'],['Grünerløkka','Oslo'],['Sagene','Oslo'],['St. Hanshaugen','Oslo'],
    ['Frogner','Oslo'],['Ullern','Oslo'],['Vestre Aker','Oslo'],['Nordre Aker','Oslo'],
    ['Bjerke','Oslo'],['Grorud','Oslo'],['Stovner','Oslo'],['Alna','Oslo'],
    ['Østensjø','Oslo'],['Nordstrand','Oslo'],['Søndre Nordstrand','Oslo'],
    ['Sentrum','Oslo'],['Marka','Oslo'],
    // Bergen: 8 bydeler
    ['Arna','Bergen'],['Bergenhus','Bergen'],['Fana','Bergen'],['Fyllingsdalen','Bergen'],
    ['Laksevåg','Bergen'],['Ytrebygda','Bergen'],['Årstad','Bergen'],['Åsane','Bergen'],
    // Trondheim: 4 bydeler
    ['Midtbyen','Trondheim'],['Østbyen','Trondheim'],['Lerkendal','Trondheim'],['Heimdal','Trondheim'],
    // Stavanger: 7 kommunedeler
    ['Eiganes og Våland','Stavanger'],['Hillevåg','Stavanger'],['Hinna','Stavanger'],
    ['Hundvåg','Stavanger'],['Madla','Stavanger'],['Storhaug','Stavanger'],['Tasta','Stavanger']
  ];

  // -- Build canonical list, deduped --------------------------------------
  // Selection rule: if a name appears as both kommune AND tettsted, drop the
  // tettsted (kommune wins). Bydeler keep their parent so duplicates by name
  // (e.g. "Frogner" — both Oslo bydel and Lillestrøm tettsted) survive but
  // disambiguate by parent in the display label.

  function unique(arr) {
    var seen = Object.create(null);
    var out = [];
    arr.forEach(function (e) {
      var key = e.name + '|' + (e.parent || '') + '|' + e.kind;
      if (seen[key]) return;
      seen[key] = 1;
      out.push(e);
    });
    return out;
  }

  var all = [];
  var kommuneSet = Object.create(null);

  KOMMUNER.forEach(function (name) {
    // Some kommuner share names (Våler, Herøy, Bø, Sande, Nes, Os). Dedup
    // by name — there's no good way to disambiguate in a free city input
    // without also asking for fylke. The kommune-level entry is canonical.
    if (kommuneSet[name]) return;
    kommuneSet[name] = 1;
    all.push({ name: name, kind: 'kommune', parent: null });
  });

  TETTSTEDER.forEach(function (pair) {
    var name = pair[0], parent = pair[1];
    // Drop tettsteder whose name equals a kommune name — kommune wins.
    if (kommuneSet[name]) return;
    all.push({ name: name, kind: 'tettsted', parent: parent });
  });

  BYDELER.forEach(function (pair) {
    all.push({ name: pair[0], kind: 'bydel', parent: pair[1] });
  });

  all = unique(all);

  // Sort: kommune < bydel < tettsted, then alphabetical. (Search ranking
  // applies its own ordering on top of this.)
  var kindRank = { kommune: 0, bydel: 1, tettsted: 2 };
  all.sort(function (a, b) {
    if (a.name === b.name) {
      return kindRank[a.kind] - kindRank[b.kind];
    }
    return a.name.localeCompare(b.name, 'no');
  });

  // -- search() — substring match, ranked --------------------------------
  // Prefix matches rank higher than mid-word. Within the same rank, shorter
  // names come first (so "Oslo" beats "Oslo havn" for "osl"). Kommuner are
  // boosted slightly so they appear ahead of less-common settlements.

  function normalize(s) {
    return String(s || '').toLowerCase().trim();
  }

  function search(query, limit) {
    limit = limit || 8;
    var q = normalize(query);
    if (!q) return [];
    var matches = [];
    all.forEach(function (e) {
      var n = normalize(e.name);
      var idx = n.indexOf(q);
      if (idx < 0) {
        // Allow parent match (e.g. typing "oslo" should surface its bydeler).
        if (e.parent && normalize(e.parent).indexOf(q) === 0) {
          matches.push({ entry: e, score: 1000 + n.length });
        }
        return;
      }
      var score = idx * 10 + n.length;
      if (e.kind === 'kommune') score -= 2;
      if (e.kind === 'bydel') score += 1;
      matches.push({ entry: e, score: score });
    });
    matches.sort(function (a, b) { return a.score - b.score; });
    return matches.slice(0, limit).map(function (m) { return m.entry; });
  }

  // -- attachTypeahead(input) — wires UX onto an existing <input> -------

  function ensureStyles() {
    if (document.getElementById('nailed-places-styles')) return;
    var css = [
      '.nailed-places-wrap{position:relative;display:block;width:100%;}',
      '.nailed-places-wrap > input{width:100%;box-sizing:border-box;}',
      '.nailed-places-dropdown{position:absolute;left:0;right:0;top:100%;margin-top:4px;background:var(--cream-50,#fff);border:1px solid var(--stone-200,#e3dcd5);border-radius:12px;box-shadow:0 12px 32px rgba(27,18,24,0.12);max-height:min(440px,65vh);overflow-y:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;z-index:1000;display:none;font-family:var(--font-body,system-ui,sans-serif);scrollbar-width:thin;scrollbar-color:var(--stone-400,#a89e93) transparent;}',
      '.nailed-places-dropdown::-webkit-scrollbar{width:8px;}',
      '.nailed-places-dropdown::-webkit-scrollbar-thumb{background:var(--stone-400,#a89e93);border-radius:4px;}',
      '.nailed-places-dropdown::-webkit-scrollbar-thumb:hover{background:var(--stone-500,#86796d);}',
      '.nailed-places-dropdown::-webkit-scrollbar-track{background:transparent;}',
      '.nailed-places-dropdown.is-open{display:block;}',
      '.nailed-places-item{padding:10px 14px;cursor:pointer;font-size:14px;color:var(--ink,#1B1218);display:flex;justify-content:space-between;align-items:center;gap:12px;border-bottom:1px solid var(--stone-100,#efeae5);}',
      '.nailed-places-item:last-child{border-bottom:0;}',
      '.nailed-places-item:hover,.nailed-places-item.is-active{background:var(--cream-100,#f5efe9);}',
      '.nailed-places-name{font-weight:500;}',
      '.nailed-places-meta{font-size:12px;color:var(--fg-muted,#7a6f68);text-transform:lowercase;}',
      '.nailed-places-empty{padding:12px 14px;color:var(--fg-muted,#7a6f68);font-size:13px;font-style:italic;}'
    ].join('\n');
    var style = document.createElement('style');
    style.id = 'nailed-places-styles';
    style.textContent = css;
    document.head.appendChild(style);
  }

  function kindLabel(kind) {
    if (kind === 'kommune') return 'kommune';
    if (kind === 'bydel') return 'bydel';
    return 'tettsted';
  }

  function displayLabel(entry) {
    // For districts and disambiguated tettsteder, append parent.
    if (entry.kind === 'bydel') return entry.name + ' · ' + entry.parent;
    if (entry.kind === 'tettsted' && entry.parent && entry.parent !== entry.name) {
      return entry.name + ' · ' + entry.parent;
    }
    return entry.name;
  }

  function attachTypeahead(input, opts) {
    if (!input || input.dataset.nailedPlacesAttached === '1') return;
    input.dataset.nailedPlacesAttached = '1';
    ensureStyles();

    opts = opts || {};

    // Wrap the input in a positioned container so the dropdown can absolute-
    // position relative to it. Preserve existing parent.
    var wrap = document.createElement('div');
    wrap.className = 'nailed-places-wrap';
    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);

    var dropdown = document.createElement('div');
    dropdown.className = 'nailed-places-dropdown';
    dropdown.setAttribute('role', 'listbox');
    wrap.appendChild(dropdown);

    input.setAttribute('autocomplete', 'off');
    input.setAttribute('spellcheck', 'false');
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-expanded', 'false');

    var lastValid = input.value || '';
    var activeIdx = -1;
    var currentResults = [];

    // Validate any preset value: if the input has a value already, accept it
    // as last-valid only if it matches a known place.
    if (lastValid && !findExact(lastValid)) {
      // Keep the value visible (e.g. legacy data) but treat as "last valid"
      // so user can re-select it. Don't blow away pre-existing data.
    }

    function findExact(name) {
      var n = normalize(name);
      for (var i = 0; i < all.length; i++) {
        if (normalize(all[i].name) === n) return all[i];
      }
      return null;
    }

    function renderResults(results) {
      currentResults = results;
      activeIdx = results.length ? 0 : -1;
      if (!results.length) {
        dropdown.innerHTML = '<div class="nailed-places-empty">Ingen treff. Prøv et annet sted.</div>';
        dropdown.classList.add('is-open');
        input.setAttribute('aria-expanded', 'true');
        return;
      }
      var html = '';
      for (var i = 0; i < results.length; i++) {
        var r = results[i];
        var label = displayLabel(r);
        html += '<div class="nailed-places-item' + (i === 0 ? ' is-active' : '') +
          '" role="option" data-idx="' + i + '">' +
          '<span class="nailed-places-name">' + escapeHtml(label) + '</span>' +
          '<span class="nailed-places-meta">' + kindLabel(r.kind) + '</span>' +
          '</div>';
      }
      dropdown.innerHTML = html;
      dropdown.classList.add('is-open');
      input.setAttribute('aria-expanded', 'true');
    }

    function close() {
      dropdown.classList.remove('is-open');
      input.setAttribute('aria-expanded', 'false');
      activeIdx = -1;
    }

    function escapeHtml(s) {
      return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
        return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
      });
    }

    function pick(entry) {
      input.value = entry.name;
      lastValid = entry.name;
      close();
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }

    function setActive(i) {
      var items = dropdown.querySelectorAll('.nailed-places-item');
      items.forEach(function (el) { el.classList.remove('is-active'); });
      if (i >= 0 && i < items.length) {
        items[i].classList.add('is-active');
        // Scroll into view if needed.
        var el = items[i];
        var top = el.offsetTop, bottom = top + el.offsetHeight;
        if (top < dropdown.scrollTop) dropdown.scrollTop = top;
        else if (bottom > dropdown.scrollTop + dropdown.clientHeight) {
          dropdown.scrollTop = bottom - dropdown.clientHeight;
        }
      }
      activeIdx = i;
    }

    input.addEventListener('input', function () {
      var q = input.value;
      if (!q.trim()) { close(); return; }
      var results = search(q, 50);
      renderResults(results);
    });

    input.addEventListener('focus', function () {
      var q = input.value;
      if (q.trim()) {
        var results = search(q, 50);
        renderResults(results);
      }
    });

    input.addEventListener('keydown', function (e) {
      var isOpen = dropdown.classList.contains('is-open');
      if (e.key === 'ArrowDown') {
        if (!isOpen) {
          var r = search(input.value || '', 50);
          if (r.length) renderResults(r);
          return;
        }
        e.preventDefault();
        if (currentResults.length) setActive((activeIdx + 1) % currentResults.length);
      } else if (e.key === 'ArrowUp') {
        if (!isOpen) return;
        e.preventDefault();
        if (currentResults.length) setActive((activeIdx - 1 + currentResults.length) % currentResults.length);
      } else if (e.key === 'Enter') {
        if (isOpen && currentResults.length && activeIdx >= 0) {
          if (opts.permissive) {
            // Permissive mode: fill the value but let Enter submit the form.
            // Only intercept if the highlighted suggestion isn't already the
            // typed text (so the user can press Enter to commit AND submit).
            var picked = currentResults[activeIdx];
            if (normalize(input.value) !== normalize(picked.name)) {
              input.value = picked.name;
              lastValid = picked.name;
            }
            close();
          } else {
            e.preventDefault();
            pick(currentResults[activeIdx]);
          }
        }
      } else if (e.key === 'Escape') {
        if (isOpen) { e.preventDefault(); close(); }
      } else if (e.key === 'Tab') {
        // Tabbing accepts the current highlight if open and there's a match.
        if (isOpen && currentResults.length && activeIdx >= 0) {
          pick(currentResults[activeIdx]);
        }
      }
    });

    dropdown.addEventListener('mousedown', function (e) {
      // mousedown (not click) so blur doesn't fire first and clear results.
      var target = e.target.closest('.nailed-places-item');
      if (!target) return;
      e.preventDefault();
      var idx = parseInt(target.getAttribute('data-idx'), 10);
      if (currentResults[idx]) pick(currentResults[idx]);
    });

    input.addEventListener('blur', function () {
      // Defer so click on dropdown lands first.
      setTimeout(function () {
        var typed = input.value.trim();
        if (!typed) {
          // Empty is okay; clear last-valid only if required allows.
          close();
          return;
        }
        if (!findExact(typed)) {
          // Permissive mode (used on the homepage hero search): keep the
          // typed value as-is and treat it as the new "lastValid". Strict
          // mode (default, used on /salong-panel and /bli-salong): restore
          // to lastValid since free text isn't a savable city.
          if (opts.permissive) {
            lastValid = typed;
          } else {
            input.value = lastValid || '';
          }
        } else {
          // Canonicalize casing.
          var match = findExact(typed);
          input.value = match.name;
          lastValid = match.name;
        }
        close();
      }, 120);
    });

    // Public API on the input element so callers can re-seed value after
    // an async load (e.g. loadSalon()). They should call `input._nailedPlaces.setValue(...)`.
    input._nailedPlaces = {
      setValue: function (v) {
        input.value = v || '';
        if (v && findExact(v)) lastValid = v;
        else if (!v) lastValid = '';
        // If legacy value doesn't match any place, leave lastValid empty so
        // user must select a known place to keep their edit.
      },
      lastValid: function () { return lastValid; }
    };
  }

  global.NailedPlaces = {
    all: all,
    search: search,
    attachTypeahead: attachTypeahead
  };
})(window);
