$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
Set-StrictMode -Version 2

[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)

function Resolve-OdbcConnectionString {
  param([string]$ConnectionString)

  $driverMatch = [regex]::Match($ConnectionString, "(?i)Driver=\{([^}]+)\}")
  if (-not $driverMatch.Success) {
    return $ConnectionString
  }

  $requestedDriver = $driverMatch.Groups[1].Value
  try {
    $installedDrivers = @(Get-OdbcDriver -ErrorAction Stop | Where-Object {
      $_.Platform -eq "64-bit" -and $_.Name -match "^MySQL ODBC .+ Unicode Driver$"
    })
    if ($installedDrivers.Name -contains $requestedDriver) {
      return $ConnectionString
    }
    $fallbackDriver = $installedDrivers |
      Sort-Object {
        if ($_.Name -match "MySQL ODBC ([0-9.]+)") {
          try { return [version]$Matches[1] } catch { return [version]"0.0" }
        }
        return [version]"0.0"
      } -Descending |
      Select-Object -First 1
    if ($fallbackDriver) {
      return $ConnectionString.Replace(
        $driverMatch.Value,
        "Driver={$($fallbackDriver.Name)}"
      )
    }
  } catch {
    # The connection attempt below will return the actionable ODBC error.
  }
  return $ConnectionString
}

function Read-RequiredDate {
  param(
    [string]$Value,
    [string]$Name
  )

  $date = [datetime]::MinValue
  if (-not [datetime]::TryParseExact(
    $Value,
    "yyyy-MM-dd",
    [Globalization.CultureInfo]::InvariantCulture,
    [Globalization.DateTimeStyles]::None,
    [ref]$date
  )) {
    throw "Некорректная дата $Name."
  }
  return $date.Date
}

function Read-DbString {
  param(
    [Data.Odbc.OdbcDataReader]$Reader,
    [string]$Name
  )

  $value = $Reader[$Name]
  if ($null -eq $value -or $value -is [DBNull]) {
    return ""
  }
  return [string]$value
}

$connectionString = Resolve-OdbcConnectionString ([string]$env:AIS_APPLICATIONS_DB)
if ([string]::IsNullOrWhiteSpace($connectionString)) {
  throw "Не настроено подключение к базе заявок."
}

$dateFrom = Read-RequiredDate ([string]$env:AIS_APPLICATIONS_DATE_FROM) "начала"
$dateTo = Read-RequiredDate ([string]$env:AIS_APPLICATIONS_DATE_TO) "окончания"
if ($dateFrom -gt $dateTo) {
  throw "Дата начала периода не может быть позже даты окончания."
}

$programName = ([string]$env:AIS_APPLICATIONS_PROGRAM_NAME).Trim()
$productId = ([string]$env:AIS_APPLICATIONS_PRODUCT_ID).Trim()
$onlyPaid = ([string]$env:AIS_APPLICATIONS_ONLY_PAID) -eq "1"

$query = @'
SELECT *
FROM (
  SELECT DISTINCTROW
    DATE_FORMAT(t_opl.date_created, '%d.%m.%Y %H:%i:%s') AS `Дата`,
    IFNULL(bn.meta_value, '') AS `ФИО`,
    CONCAT(
      t_opl.order_id, ' ',
      IF(
        os.status IN ('wc-completed', 'wc-processing') AND os.total_sales > 0,
        CONCAT('опл ', IFNULL(itotal.meta_value, '')),
        ''
      ),
      ' ',
      IFNULL(coup.order_item_name, '')
    ) AS `Заказ (оплата)`,
    CONCAT(oi.order_item_name, ' [', IFNULL(iprod.meta_value, ''), ']') AS `Программа`,
    IFNULL(bp.meta_value, '') AS `Телефон`,
    IFNULL(be.meta_value, '') AS `Email`,
    IFNULL(bcity.meta_value, '') AS `Город`,
    IFNULL(bcomp.meta_value, '') AS `Организация`,
    IFNULL(baddr1.meta_value, '') AS `Должность`,
    IFNULL(baddr2.meta_value, '') AS `Источник`,
    IFNULL(bcomm.post_excerpt, '') AS `Примечание`,
    IFNULL(coup.order_item_name, '') AS source_coupon,
    t_opl.date_created,
    t_opl.order_id AS source_order_id,
    oi.order_item_id AS source_line_item_id,
    IFNULL(iprod.meta_value, '') AS source_product_id,
    IF(
      os.status IN ('wc-completed', 'wc-processing') AND os.total_sales > 0,
      1,
      0
    ) AS source_is_paid,
    IF(
      os.status IN ('wc-completed', 'wc-processing') AND os.total_sales > 0,
      IFNULL(itotal.meta_value, 0),
      0
    ) AS source_payment_amount
  FROM wp_wc_order_product_lookup AS t_opl
  INNER JOIN wp_wc_order_stats os
    ON t_opl.order_id = os.order_id
  INNER JOIN wp_woocommerce_order_items oi
    ON t_opl.order_id = oi.order_id
    AND oi.order_item_type = 'line_item'
  LEFT JOIN wp_woocommerce_order_itemmeta iprod
    ON oi.order_item_id = iprod.order_item_id
    AND iprod.meta_key = '_product_id'
  LEFT JOIN wp_woocommerce_order_itemmeta itotal
    ON oi.order_item_id = itotal.order_item_id
    AND itotal.meta_key = '_line_total'
  LEFT JOIN wp_postmeta bn
    ON t_opl.order_id = bn.post_id
    AND bn.meta_key = '_billing_first_name'
  LEFT JOIN wp_postmeta bp
    ON t_opl.order_id = bp.post_id
    AND bp.meta_key = '_billing_phone'
  LEFT JOIN wp_postmeta be
    ON t_opl.order_id = be.post_id
    AND be.meta_key = '_billing_email'
  LEFT JOIN wp_postmeta bcity
    ON t_opl.order_id = bcity.post_id
    AND bcity.meta_key = '_billing_city'
  LEFT JOIN wp_postmeta bcomp
    ON t_opl.order_id = bcomp.post_id
    AND bcomp.meta_key = '_billing_company'
  LEFT JOIN wp_postmeta baddr1
    ON t_opl.order_id = baddr1.post_id
    AND baddr1.meta_key = '_billing_address_1'
  LEFT JOIN wp_postmeta baddr2
    ON t_opl.order_id = baddr2.post_id
    AND baddr2.meta_key = '_billing_address_2'
  LEFT JOIN wp_posts bcomm
    ON t_opl.order_id = bcomm.id
    AND bcomm.post_excerpt != ''
  LEFT JOIN wp_woocommerce_order_items coup
    ON t_opl.order_id = coup.order_id
    AND coup.order_item_type = 'coupon'
) AS t_all
WHERE date_created >= ?
  AND date_created < ?
'@

$configuredQuery = ([string]$env:AIS_APPLICATIONS_SQL_QUERY).Trim()
if (-not [string]::IsNullOrWhiteSpace($configuredQuery)) {
  $query = $configuredQuery
}

$parameterValues = [Collections.Generic.List[object]]::new()
$parameterValues.Add($dateFrom)
$parameterValues.Add($dateTo.AddDays(1))

if ($productId -and $programName) {
  $query += " AND (source_product_id = ? OR `Программа` LIKE ?)"
  $parameterValues.Add($productId)
  $parameterValues.Add("%$programName%")
} elseif ($productId) {
  $query += " AND source_product_id = ?"
  $parameterValues.Add($productId)
} elseif ($programName) {
  $query += " AND `Программа` LIKE ?"
  $parameterValues.Add("%$programName%")
}

if ($onlyPaid) {
  $query += " AND source_is_paid = 1"
}

$query += " ORDER BY source_order_id DESC, source_line_item_id LIMIT 5000"

$connection = [Data.Odbc.OdbcConnection]::new($connectionString)
try {
  $connection.Open()
  $command = $connection.CreateCommand()
  $command.CommandText = $query
  foreach ($value in $parameterValues) {
    $parameter = $command.Parameters.Add("@value", [Data.Odbc.OdbcType]::VarChar)
    if ($value -is [datetime]) {
      $parameter.OdbcType = [Data.Odbc.OdbcType]::DateTime
      $parameter.Value = $value
    } else {
      $parameter.Value = [string]$value
    }
  }

  $rows = [Collections.Generic.List[object]]::new()
  $reader = $command.ExecuteReader()
  try {
    while ($reader.Read()) {
      $dateCreated = [datetime]$reader["date_created"]
      $orderId = Read-DbString $reader "source_order_id"
      $lineItemId = Read-DbString $reader "source_line_item_id"
      $paymentAmount = 0.0
      [double]::TryParse(
        (Read-DbString $reader "source_payment_amount").Replace(",", "."),
        [Globalization.NumberStyles]::Any,
        [Globalization.CultureInfo]::InvariantCulture,
        [ref]$paymentAmount
      ) | Out-Null
      $rows.Add([ordered]@{
        id = "$orderId-$lineItemId"
        date = Read-DbString $reader "Дата"
        dateCreated = $dateCreated.ToString("yyyy-MM-ddTHH:mm:ss")
        name = Read-DbString $reader "ФИО"
        order = Read-DbString $reader "Заказ (оплата)"
        orderId = $orderId
        program = Read-DbString $reader "Программа"
        productId = Read-DbString $reader "source_product_id"
        phone = Read-DbString $reader "Телефон"
        email = Read-DbString $reader "Email"
        city = Read-DbString $reader "Город"
        organization = Read-DbString $reader "Организация"
        position = Read-DbString $reader "Должность"
        source = Read-DbString $reader "Источник"
        coupon = Read-DbString $reader "source_coupon"
        note = Read-DbString $reader "Примечание"
        paid = ([int]$reader["source_is_paid"]) -eq 1
        paymentAmount = $paymentAmount
      })
    }
  } finally {
    $reader.Dispose()
    $command.Dispose()
  }

  [ordered]@{
    rows = $rows
    total = $rows.Count
    truncated = $rows.Count -ge 5000
  } | ConvertTo-Json -Depth 5 -Compress
} finally {
  $connection.Dispose()
}
