-- The baseline theme needs storefront-core 0.3.0 since #1036 (themes/baseline/template.json); its row still said 0.0.0.
update storefront_template set core_min_version = '0.3.0' where key = 'baseline' and core_min_version = '0.0.0';
