-- Empreintes visuelles des images (exigence 9.11) : 64 caractères hexadécimaux ; NULL : pas encore calculée ;
-- chaîne vide : non calculable (illisible, quasi unie, animée). Sert à reconnaître les quasi-doublons.
ALTER TABLE media ADD COLUMN fingerprint TEXT;
