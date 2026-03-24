<?php
/**
 * Plugin Name: OMEX WhatsApp Demo
 * Description: Demo interactivo via WhatsApp Web + IA. Conecta con Railway.
 * Version: 1.0.0
 * Author: Online Mexico (OMEX)
 */
if (!defined('ABSPATH')) { exit; }

define('OMEX_DEMO_VERSION', '1.0.0');
define('OMEX_DEMO_DIR', plugin_dir_path(__FILE__));
define('OMEX_DEMO_URL', plugin_dir_url(__FILE__));

function omex_demo_settings() {
    return [
        'railway_url' => get_option('omex_demo_railway_url', ''),
        'secret'      => get_option('omex_demo_secret', ''),
        'ttl_min'     => (int) get_option('omex_demo_ttl', 30),
    ];
}

add_action('admin_menu', function() {
    add_options_page('OMEX Demo Config', 'OMEX Demo', 'manage_options', 'omex-demo', 'omex_demo_admin_page');
});
add_action('admin_init', function() {
    register_setting('omex_demo_group', 'omex_demo_railway_url');
    register_setting('omex_demo_group', 'omex_demo_secret');
    register_setting('omex_demo_group', 'omex_demo_ttl');
});

function omex_demo_admin_page() {
    $cfg = omex_demo_settings();
    ?>
    <div class="wrap">
        <h1>OMEX Demo &mdash; Configuracion</h1>
        <?php if (empty($cfg['railway_url'])): ?>
        <div class="notice notice-warning"><p><strong>Falta la URL de Railway.</strong> Despliega el servidor en Railway y pega la URL aqui.</p></div>
        <?php endif; ?>
        <form method="post" action="options.php">
            <?php settings_fields('omex_demo_group'); ?>
            <table class="form-table">
                <tr><th><label for="railway_url">URL Railway</label></th>
                <td><input type="url" id="railway_url" name="omex_demo_railway_url" value="<?= esc_attr($cfg['railway_url']) ?>" class="regular-text" placeholder="https://omex-demo.up.railway.app" />
                <p class="description">La URL publica que da Railway al hacer deploy.</p></td></tr>
                <tr><th><label for="secret">Clave secreta</label></th>
                <td><input type="text" id="secret" name="omex_demo_secret" value="<?= esc_attr($cfg['secret']) ?>" class="regular-text" placeholder="clave-larga-aleatoria" />
                <p class="description">Debe coincidir con la variable <code>DEMO_SECRET</code> en Railway.</p></td></tr>
                <tr><th><label for="ttl">Duracion demo (min)</label></th>
                <td><input type="number" id="ttl" name="omex_demo_ttl" value="<?= esc_attr($cfg['ttl_min']) ?>" min="5" max="60" class="small-text" /> minutos</td></tr>
            </table>
            <?php submit_button('Guardar configuracion'); ?>
        </form>
        <?php if (!empty($cfg['railway_url'])): ?>
        <hr><h2>Estado del servidor</h2>
        <?php $health = omex_demo_call_railway('GET', '/health');
        if (!is_wp_error($health) && !empty($health['ok'])): ?>
            <div class="notice notice-success is-dismissible"><p>Servidor Railway activo &middot; Sesiones: <strong><?= intval($health['sessions'] ?? 0) ?></strong> &middot; Uptime: <?= esc_html($health['uptime'] ?? '-') ?></p></div>
        <?php else: ?>
            <div class="notice notice-error"><p>No se pudo conectar al servidor Railway. Revisa la URL y la clave.</p></div>
        <?php endif; endif; ?>
        <hr><h2>Uso</h2>
        <p>Shortcode en cualquier pagina: <code>[omex_demo]</code></p>
        <p>Con opciones: <code>[omex_demo title="Prueba tu bot" cta_url="/contacto"]</code></p>
    </div>
    <?php
}

add_action('rest_api_init', function() {
    $routes = [
        ['POST',   '/create',                       'omex_demo_rest_create'],
        ['GET',    '/status/(?P<sid>[a-z0-9\-]+)', 'omex_demo_rest_status'],
        ['DELETE', '/destroy/(?P<sid>[a-z0-9\-]+)','omex_demo_rest_destroy'],
    ];
    foreach ($routes as [$method, $path, $cb]) {
        register_rest_route('omex-demo/v1', $path, [
            'methods' => $method, 'callback' => $cb,
            'permission_callback' => 'omex_demo_verify_nonce',
        ]);
    }
});

function omex_demo_verify_nonce(WP_REST_Request $req) {
    $nonce = $req->get_header('X-WP-Nonce') ?: $req->get_param('_wpnonce');
    return (bool) wp_verify_nonce($nonce, 'wp_rest');
}

function omex_demo_rest_create(WP_REST_Request $req) {
    $body = $req->get_json_params() ?: [];
    $company  = sanitize_text_field($body['company'] ?? '');
    $services = sanitize_textarea_field($body['services'] ?? '');
    $site_url = esc_url_raw($body['site_url'] ?? '');
    if (empty($company)) return new WP_Error('missing', 'Nombre de empresa requerido.', ['status' => 400]);
    $openai_key = '';
    if (class_exists('OMEX_TWILIO_WA_DB')) {
        $s = OMEX_TWILIO_WA_DB::get_settings();
        $openai_key = trim($s['openai_api_key'] ?? '');
    }
    if (empty($openai_key)) return new WP_Error('no_key', 'Configura la API key de OpenAI en el plugin OMEX principal.', ['status' => 500]);
    $result = omex_demo_call_railway('POST', '/demo/create', compact('company','services','site_url','openai_key'));
    return is_wp_error($result) ? new WP_REST_Response(['ok'=>false,'error'=>$result->get_error_message()],500) : new WP_REST_Response($result, 200);
}

function omex_demo_rest_status(WP_REST_Request $req) {
    $sid = sanitize_text_field($req->get_param('sid'));
    $result = omex_demo_call_railway('GET', "/demo/status/{$sid}");
    return is_wp_error($result) ? new WP_REST_Response(['ok'=>false,'error'=>$result->get_error_message()],500) : new WP_REST_Response($result, 200);
}

function omex_demo_rest_destroy(WP_REST_Request $req) {
    $sid = sanitize_text_field($req->get_param('sid'));
    $result = omex_demo_call_railway('POST', "/demo/destroy/{$sid}");
    return is_wp_error($result) ? new WP_REST_Response(['ok'=>false,'error'=>$result->get_error_message()],500) : new WP_REST_Response($result, 200);
}

function omex_demo_call_railway($method, $path, $body = null) {
    $cfg = omex_demo_settings();
    if (empty($cfg['railway_url'])) return new WP_Error('no_url', 'URL de Railway no configurada.');
    $url = rtrim($cfg['railway_url'], '/') . $path;
    $args = ['method'=>$method,'timeout'=>30,'headers'=>['Content-Type'=>'application/json','X-Omex-Demo-Key'=>$cfg['secret']]];
    if ($body !== null) $args['body'] = wp_json_encode($body);
    $response = wp_remote_request($url, $args);
    if (is_wp_error($response)) return $response;
    $code = wp_remote_retrieve_response_code($response);
    $data = json_decode(wp_remote_retrieve_body($response), true);
    if ($code >= 400) return new WP_Error('railway_error', $data['error'] ?? "Error HTTP {$code}");
    return is_array($data) ? $data : ['ok'=>true];
}

add_action('wp_enqueue_scripts', function() {
    global $post;
    if (!is_a($post,'WP_Post') || !has_shortcode($post->post_content,'omex_demo')) return;
    $cfg = omex_demo_settings();
    $railway_url = rtrim($cfg['railway_url'], '/');
    if ($railway_url) wp_enqueue_script('socket-io', $railway_url.'/socket.io/socket.io.js', [], null, true);
    wp_enqueue_script('omex-demo-js', OMEX_DEMO_URL.'assets/demo.js', ['jquery','socket-io'], OMEX_DEMO_VERSION, true);
    wp_enqueue_style('omex-demo-css', OMEX_DEMO_URL.'assets/demo.css', [], OMEX_DEMO_VERSION);
    wp_localize_script('omex-demo-js', 'OmexDemo', [
        'restUrl'   => rest_url('omex-demo/v1'),
        'nonce'     => wp_create_nonce('wp_rest'),
        'socketUrl' => $railway_url,
        'ttlMin'    => $cfg['ttl_min'],
    ]);
});

add_shortcode('omex_demo', function($atts) {
    $atts = shortcode_atts(['title'=>'Prueba tu bot de WhatsApp ahora!','cta_url'=>'/contacto'], $atts);
    ob_start(); ?>
    <div id="omex-demo-app">
        <div id="omex-step-form" class="omex-step omex-active">
            <h2 class="omex-title"><?= esc_html($atts['title']) ?></h2>
            <p class="omex-sub">Llena el formulario y en segundos tendras tu bot respondiendo con la informacion de tu negocio.</p>
            <form id="omex-form" novalidate>
                <div class="omex-field"><label>Nombre de tu empresa <span class="omex-req">*</span></label>
                <input type="text" id="omex-company" placeholder="Ej: Agencia Digital XYZ" required maxlength="120" /></div>
                <div class="omex-field"><label>Servicios o productos que ofreces</label>
                <textarea id="omex-services" rows="3" placeholder="Ej: Diseno web, SEO, Redes sociales..." maxlength="600"></textarea></div>
                <div class="omex-field"><label>URL de tu sitio web <span class="omex-scan-badge">IA lo escanea automaticamente</span></label>
                <input type="url" id="omex-site" placeholder="https://tusitioweb.com" maxlength="300" />
                <small>Opcional - la IA leera tu sitio y personalizara el bot con tu informacion real.</small></div>
                <div id="omex-error" class="omex-error" style="display:none"></div>
                <button type="submit" id="omex-submit" class="omex-btn omex-btn-green">
                    <span class="omex-btn-label">Crear mi bot demo</span>
                    <span class="omex-btn-loading" style="display:none"><span class="omex-spin"></span> Preparando...</span>
                </button>
            </form>
        </div>
        <div id="omex-step-scan" class="omex-step" style="display:none">
            <div class="omex-scan-wrap">
                <div class="omex-scan-icon">🔍</div>
                <h3>La IA esta leyendo tu sitio...</h3>
                <p>Detectando servicios y datos clave para personalizar tu bot.</p>
                <div class="omex-bar"><div class="omex-bar-fill"></div></div>
            </div>
        </div>
        <div id="omex-step-qr" class="omex-step" style="display:none">
            <h3>Tu bot esta listo! Escanea el QR</h3>
            <div class="omex-qr-wrap">
                <div class="omex-qr-box"><img id="omex-qr-img" src="" alt="QR WhatsApp" /></div>
                <div class="omex-qr-steps">
                    <p><strong>Como conectarlo:</strong></p>
                    <ol><li>Abre WhatsApp en tu celular</li><li>Ve a <strong>Dispositivos vinculados</strong></li><li>Toca <strong>Vincular un dispositivo</strong></li><li>Escanea este codigo</li></ol>
                    <div id="omex-facts" style="display:none" class="omex-facts-box"><strong>Detectado en tu sitio:</strong><div id="omex-facts-content"></div></div>
                </div>
            </div>
            <p class="omex-ttl">Sesion expira en: <strong id="omex-ttl-val">30:00</strong></p>
        </div>
        <div id="omex-step-live" class="omex-step" style="display:none">
            <div class="omex-live-header"><span class="omex-dot"></span><h3>Bot activo - <span id="omex-cname"></span></h3></div>
            <p>Escribe a tu numero desde <strong>otro celular</strong> y mira como responde aqui:</p>
            <div id="omex-chat" class="omex-chat"></div>
            <div class="omex-live-actions">
                <button id="omex-end" class="omex-btn omex-btn-gray">Terminar demo</button>
                <a href="<?= esc_url($atts['cta_url']) ?>" class="omex-btn omex-btn-green">Quiero esto para mi negocio</a>
            </div>
        </div>
        <div id="omex-step-end" class="omex-step" style="display:none">
            <div class="omex-end-wrap">
                <div class="omex-end-icon">🎉</div>
                <h3>Como te fue con el demo?</h3>
                <p>Podemos configurarlo para tu negocio con tu numero propio de WhatsApp Business.</p>
                <a href="<?= esc_url($atts['cta_url']) ?>" class="omex-btn omex-btn-green">Contactanos</a>
                <button id="omex-restart" class="omex-btn omex-btn-ghost">Hacer otra demo</button>
            </div>
        </div>
    </div>
    <?php return ob_get_clean();
});
