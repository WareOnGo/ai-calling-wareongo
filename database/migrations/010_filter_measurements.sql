-- Unknown/unparsed measurements remain NULL rather than becoming zero.
CREATE FUNCTION bolna_numeric_measure(value text) RETURNS numeric LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN regexp_replace(trim(value),'[,[:space:]]','','g') ~ '^[0-9]+(\.[0-9]+)?$'
    THEN regexp_replace(trim(value),'[,[:space:]]','','g')::numeric ELSE NULL END
$$;
CREATE FUNCTION bolna_rent_mentioned(value text) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT lower(trim(coalesce(value,''))) NOT IN ('','na','n/a','none','null','unknown','not mentioned','not available','-','tbd')
$$;
