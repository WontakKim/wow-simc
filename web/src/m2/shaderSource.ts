// GLSL sources for the native M2 batches, three.js ShaderMaterial flavor
// (attribute/varying/texture2D syntax; three upgrades to GLSL3 on WebGL2).
// The pixel combiners mirror evaluateM2PixelCombiner in ./shaders case by
// case, ported from the wow.export reference shader (MIT) with the WoW
// lighting model from research/rendering/m2-format-and-rendering.md section 11.
// No tonemapping or output-encode include: combiner output is display-domain
// and reaches the canvas unchanged.

export const M2_VERTEX_SHADER_SOURCE = /* glsl */ `
attribute vec2 uv2;
attribute vec4 skinIndex;
attribute vec4 skinWeight;

uniform sampler2D u_bone_texture;
uniform float u_bone_count;
uniform mat4 u_tex_matrix1;
uniform mat4 u_tex_matrix2;
uniform int u_vertex_shader;

varying vec2 v_texcoord;
varying vec2 v_texcoord2;
varying vec2 v_texcoord3;
varying vec3 v_normal_world;
varying vec3 v_normal_view;
varying vec3 v_position_view;
varying float v_edge_fade;

mat4 boneMatrix(int index) {
  float row = (float(index) + 0.5) / u_bone_count;
  vec4 c0 = texture2D(u_bone_texture, vec2(0.125, row));
  vec4 c1 = texture2D(u_bone_texture, vec2(0.375, row));
  vec4 c2 = texture2D(u_bone_texture, vec2(0.625, row));
  vec4 c3 = texture2D(u_bone_texture, vec2(0.875, row));
  return mat4(c0, c1, c2, c3);
}

vec2 calcEnvCoord(vec3 posView, vec3 normalView) {
  vec3 r = reflect(normalize(posView), normalize(normalView));
  float m = 2.0 * sqrt(r.x * r.x + r.y * r.y + (r.z + 1.0) * (r.z + 1.0));
  return vec2(r.x / m + 0.5, r.y / m + 0.5);
}

float calcEdgeFade(vec3 posView, vec3 normalView) {
  vec3 viewDir = normalize(-posView);
  float c = clamp(dot(normalize(normalView), viewDir), 0.0, 1.0);
  return clamp(2.7 * c * c - 0.4, 0.0, 1.0);
}

void main() {
  mat4 boneTransform = mat4(1.0);
  float totalWeight = skinWeight.x + skinWeight.y + skinWeight.z + skinWeight.w;
  if (totalWeight > 0.0) {
    boneTransform =
      skinWeight.x * boneMatrix(int(skinIndex.x))
      + skinWeight.y * boneMatrix(int(skinIndex.y))
      + skinWeight.z * boneMatrix(int(skinIndex.z))
      + skinWeight.w * boneMatrix(int(skinIndex.w));
    boneTransform /= totalWeight;
  }

  vec4 skinnedPos = boneTransform * vec4(position, 1.0);
  vec4 worldPos = modelMatrix * skinnedPos;
  vec4 viewPos = modelViewMatrix * skinnedPos;
  gl_Position = projectionMatrix * viewPos;

  vec3 skinnedNormal = mat3(boneTransform) * normal;
  v_normal_world = normalize(mat3(modelMatrix) * skinnedNormal);
  v_normal_view = normalize(mat3(modelViewMatrix) * skinnedNormal);
  v_position_view = viewPos.xyz;

  vec2 envCoord = calcEnvCoord(v_position_view, v_normal_view);
  float edgeScan = calcEdgeFade(v_position_view, v_normal_view);
  v_edge_fade = 1.0;

  v_texcoord = uv;
  v_texcoord2 = vec2(0.0);
  v_texcoord3 = vec2(0.0);

  switch (u_vertex_shader) {
    case 0: // Diffuse_T1
      v_texcoord = (u_tex_matrix1 * vec4(uv, 0.0, 1.0)).xy;
      break;
    case 1: // Diffuse_Env
      v_texcoord = envCoord;
      break;
    case 2: // Diffuse_T1_T2
      v_texcoord = (u_tex_matrix1 * vec4(uv, 0.0, 1.0)).xy;
      v_texcoord2 = (u_tex_matrix2 * vec4(uv2, 0.0, 1.0)).xy;
      break;
    case 3: // Diffuse_T1_Env
      v_texcoord = (u_tex_matrix1 * vec4(uv, 0.0, 1.0)).xy;
      v_texcoord2 = envCoord;
      break;
    case 4: // Diffuse_Env_T1
      v_texcoord = envCoord;
      v_texcoord2 = (u_tex_matrix1 * vec4(uv, 0.0, 1.0)).xy;
      break;
    case 5: // Diffuse_Env_Env
      v_texcoord = envCoord;
      v_texcoord2 = envCoord;
      break;
    case 6: // Diffuse_T1_Env_T1
      v_texcoord = (u_tex_matrix1 * vec4(uv, 0.0, 1.0)).xy;
      v_texcoord2 = envCoord;
      v_texcoord3 = (u_tex_matrix1 * vec4(uv, 0.0, 1.0)).xy;
      break;
    case 7: // Diffuse_T1_T1
      v_texcoord = (u_tex_matrix1 * vec4(uv, 0.0, 1.0)).xy;
      v_texcoord2 = (u_tex_matrix1 * vec4(uv, 0.0, 1.0)).xy;
      break;
    case 8: // Diffuse_T1_T1_T1
      v_texcoord = (u_tex_matrix1 * vec4(uv, 0.0, 1.0)).xy;
      v_texcoord2 = (u_tex_matrix1 * vec4(uv, 0.0, 1.0)).xy;
      v_texcoord3 = (u_tex_matrix1 * vec4(uv, 0.0, 1.0)).xy;
      break;
    case 9: // Diffuse_EdgeFade_T1
      v_edge_fade = edgeScan;
      v_texcoord = (u_tex_matrix1 * vec4(uv, 0.0, 1.0)).xy;
      break;
    case 10: // Diffuse_T2
      v_texcoord = (u_tex_matrix2 * vec4(uv2, 0.0, 1.0)).xy;
      break;
    case 11: // Diffuse_T1_Env_T2
      v_texcoord = (u_tex_matrix1 * vec4(uv, 0.0, 1.0)).xy;
      v_texcoord2 = envCoord;
      v_texcoord3 = (u_tex_matrix2 * vec4(uv2, 0.0, 1.0)).xy;
      break;
    case 12: // Diffuse_EdgeFade_T1_T2
      v_edge_fade = edgeScan;
      v_texcoord = (u_tex_matrix1 * vec4(uv, 0.0, 1.0)).xy;
      v_texcoord2 = (u_tex_matrix2 * vec4(uv2, 0.0, 1.0)).xy;
      break;
    case 13: // Diffuse_EdgeFade_Env
      v_edge_fade = edgeScan;
      v_texcoord = envCoord;
      break;
    case 14: // Diffuse_T1_T2_T1
      v_texcoord = (u_tex_matrix1 * vec4(uv, 0.0, 1.0)).xy;
      v_texcoord2 = (u_tex_matrix2 * vec4(uv2, 0.0, 1.0)).xy;
      v_texcoord3 = (u_tex_matrix1 * vec4(uv, 0.0, 1.0)).xy;
      break;
    case 15: // Diffuse_T1_T2_T3 (unsupported; gated by the renderer)
      v_texcoord = (u_tex_matrix1 * vec4(uv, 0.0, 1.0)).xy;
      v_texcoord2 = (u_tex_matrix2 * vec4(uv2, 0.0, 1.0)).xy;
      v_texcoord3 = uv2;
      break;
    case 16: // Color_T1_T2_T3 (unsupported; gated by the renderer)
      v_texcoord = (u_tex_matrix2 * vec4(uv2, 0.0, 1.0)).xy;
      v_texcoord2 = vec2(0.0);
      v_texcoord3 = uv2;
      break;
    case 17: // BW_Diffuse_T1 (unsupported; gated by the renderer)
    case 18: // BW_Diffuse_T1_T2 (unsupported; gated by the renderer)
      v_texcoord = (u_tex_matrix1 * vec4(uv, 0.0, 1.0)).xy;
      break;
    default:
      v_texcoord = uv;
      break;
  }
}
`;

export const M2_FRAGMENT_SHADER_SOURCE = /* glsl */ `
uniform sampler2D u_texture1;
uniform sampler2D u_texture2;
uniform sampler2D u_texture3;
uniform sampler2D u_texture4;

uniform int u_pixel_shader;
uniform int u_blend_mode;
uniform vec4 u_mesh_color;
uniform vec3 u_tex_sample_alpha;
uniform float u_alpha_test;
uniform int u_apply_lighting;
uniform int u_unsupported;

uniform vec3 u_ambient_sky;
uniform vec3 u_ambient_horizon;
uniform vec3 u_ambient_ground;
uniform vec3 u_sun_color;
uniform vec3 u_sun_direction;
uniform vec3 u_local_light;
uniform vec3 u_unlit_add;
uniform vec3 u_fog_color;
uniform vec2 u_fog_range;
uniform int u_unfogged;

varying vec2 v_texcoord;
varying vec2 v_texcoord2;
varying vec2 v_texcoord3;
varying vec3 v_normal_world;
varying vec3 v_position_view;
varying vec3 v_normal_view;
varying float v_edge_fade;

void main() {
  vec2 uv1 = v_texcoord;
  vec2 uv2 = v_texcoord2;
  vec2 uv3 = v_texcoord3;
  // Shaders 26-28 sample every texture at uv1.
  if (u_pixel_shader == 26 || u_pixel_shader == 27 || u_pixel_shader == 28) {
    uv2 = uv1;
    uv3 = uv1;
  }

  vec4 tex1 = texture2D(u_texture1, uv1);
  vec4 tex2 = texture2D(u_texture2, uv2);
  vec4 tex3 = texture2D(u_texture3, uv3);

  vec3 meshColor = u_mesh_color.rgb;
  float meshOpacity = u_mesh_color.a * v_edge_fade;
  float w1 = u_tex_sample_alpha.r;
  float w2 = u_tex_sample_alpha.g;
  float w3 = u_tex_sample_alpha.b;

  vec3 matDiffuse = vec3(0.0);
  vec3 specular = vec3(0.0);
  float discardAlpha = 1.0;
  bool canDiscard = false;

  switch (u_pixel_shader) {
    case 0:
      matDiffuse = meshColor * tex1.rgb;
      break;
    case 1:
      matDiffuse = meshColor * tex1.rgb;
      discardAlpha = tex1.a;
      canDiscard = true;
      break;
    case 2:
      matDiffuse = meshColor * tex1.rgb * tex2.rgb;
      discardAlpha = tex2.a;
      canDiscard = true;
      break;
    case 3:
      matDiffuse = meshColor * tex1.rgb * tex2.rgb * 2.0;
      discardAlpha = tex2.a * 2.0;
      canDiscard = true;
      break;
    case 4:
      matDiffuse = meshColor * tex1.rgb * tex2.rgb * 2.0;
      break;
    case 5:
      matDiffuse = meshColor * tex1.rgb * tex2.rgb;
      break;
    case 6:
      matDiffuse = meshColor * tex1.rgb * tex2.rgb;
      discardAlpha = tex1.a * tex2.a;
      canDiscard = true;
      break;
    case 7:
      matDiffuse = meshColor * tex1.rgb * tex2.rgb * 2.0;
      discardAlpha = tex1.a * tex2.a * 2.0;
      canDiscard = true;
      break;
    case 8:
      matDiffuse = meshColor * tex1.rgb;
      discardAlpha = tex1.a + tex2.a;
      canDiscard = true;
      specular = tex2.rgb;
      break;
    case 9:
      matDiffuse = meshColor * tex1.rgb * tex2.rgb * 2.0;
      discardAlpha = tex1.a;
      canDiscard = true;
      break;
    case 10:
      matDiffuse = meshColor * tex1.rgb;
      discardAlpha = tex1.a;
      canDiscard = true;
      specular = tex2.rgb;
      break;
    case 11:
      matDiffuse = meshColor * tex1.rgb * tex2.rgb;
      discardAlpha = tex1.a;
      canDiscard = true;
      break;
    case 12:
      matDiffuse = meshColor * mix(tex1.rgb * tex2.rgb * 2.0, tex1.rgb, vec3(tex1.a));
      break;
    case 13:
      matDiffuse = meshColor * tex1.rgb;
      specular = tex2.rgb * tex2.a;
      break;
    case 14:
      matDiffuse = meshColor * tex1.rgb;
      specular = tex2.rgb * tex2.a * (1.0 - tex1.a);
      break;
    case 15:
      matDiffuse = meshColor * mix(tex1.rgb * tex2.rgb * 2.0, tex1.rgb, vec3(tex1.a));
      specular = tex3.rgb * tex3.a * w3;
      break;
    case 16:
      matDiffuse = meshColor * tex1.rgb;
      discardAlpha = tex1.a;
      canDiscard = true;
      specular = tex2.rgb * tex2.a;
      break;
    case 17:
      matDiffuse = meshColor * tex1.rgb;
      discardAlpha = tex1.a + tex2.a * (0.3 * tex2.r + 0.59 * tex2.g + 0.11 * tex2.b);
      canDiscard = true;
      specular = tex2.rgb * tex2.a * (1.0 - tex1.a);
      break;
    case 18:
      matDiffuse = meshColor * mix(mix(tex1.rgb, tex2.rgb, vec3(tex2.a)), tex1.rgb, vec3(tex1.a));
      break;
    case 19:
      matDiffuse = meshColor * mix(tex1.rgb * tex2.rgb * 2.0, tex3.rgb, vec3(tex3.a));
      break;
    case 20:
      matDiffuse = meshColor * tex1.rgb;
      specular = tex2.rgb * tex2.a * w2;
      break;
    case 21:
      matDiffuse = meshColor * tex1.rgb;
      discardAlpha = tex1.a + tex2.a;
      canDiscard = true;
      specular = tex2.rgb * (1.0 - tex1.a);
      break;
    case 22:
      matDiffuse = meshColor * mix(tex1.rgb * tex2.rgb, tex1.rgb, vec3(tex1.a));
      break;
    case 23:
      matDiffuse = meshColor * tex1.rgb;
      discardAlpha = tex1.a;
      canDiscard = true;
      specular = tex2.rgb * tex2.a * w2;
      break;
    case 24:
      matDiffuse = meshColor * mix(tex1.rgb, tex2.rgb, vec3(tex2.a));
      specular = tex1.rgb * tex1.a * w1;
      break;
    case 25: {
      float glowOpacity = clamp(tex3.a * w3, 0.0, 1.0);
      matDiffuse = meshColor * mix(tex1.rgb * tex2.rgb * 2.0, tex1.rgb, vec3(tex1.a)) * (1.0 - glowOpacity);
      specular = tex3.rgb * glowOpacity;
      break;
    }
    case 26: {
      vec4 mixed = mix(mix(tex1, tex2, vec4(clamp(w2, 0.0, 1.0))), tex3, vec4(clamp(w3, 0.0, 1.0)));
      matDiffuse = meshColor * mixed.rgb;
      discardAlpha = mixed.a;
      canDiscard = true;
      break;
    }
    case 27:
      matDiffuse = meshColor * mix(mix(tex1.rgb * tex2.rgb * 2.0, tex3.rgb, vec3(tex3.a)), tex1.rgb, vec3(tex1.a));
      break;
    case 28: {
      vec4 mixed = mix(mix(tex1, tex2, vec4(clamp(w2, 0.0, 1.0))), tex3, vec4(clamp(w3, 0.0, 1.0)));
      matDiffuse = meshColor * mixed.rgb;
      discardAlpha = mixed.a * texture2D(u_texture4, uv1).a;
      canDiscard = true;
      break;
    }
    case 29:
      matDiffuse = meshColor * mix(tex1.rgb, tex2.rgb, vec3(tex2.a));
      break;
    case 30:
      matDiffuse = meshColor * mix(tex1.rgb * mix(vec3(1.0), tex2.rgb, vec3(tex2.a)), tex3.rgb, vec3(tex3.a));
      discardAlpha = tex1.a;
      canDiscard = true;
      break;
    case 31:
      matDiffuse = meshColor * tex1.rgb * mix(vec3(1.0), tex2.rgb, vec3(tex2.a));
      discardAlpha = tex1.a;
      canDiscard = true;
      break;
    case 32:
      matDiffuse = meshColor * mix(tex1.rgb * mix(vec3(1.0), tex2.rgb, vec3(tex2.a)), tex3.rgb, vec3(tex3.a));
      break;
    case 33:
      matDiffuse = meshColor * tex1.rgb;
      discardAlpha = tex1.a;
      canDiscard = true;
      break;
    case 35:
      matDiffuse = meshColor * tex1.rgb * tex2.rgb * tex3.rgb;
      discardAlpha = tex1.a * tex2.a * tex3.a;
      canDiscard = true;
      break;
    case 36:
      matDiffuse = meshColor * tex1.rgb * tex2.rgb;
      discardAlpha = tex1.a * tex2.a;
      canDiscard = true;
      break;
    default:
      matDiffuse = meshColor * tex1.rgb;
      break;
  }

  float finalOpacity;
  bool doDiscard = false;
  if (u_blend_mode == 0) {
    finalOpacity = meshOpacity;
  } else if (u_blend_mode == 1) {
    finalOpacity = meshOpacity;
    if (canDiscard && discardAlpha < u_alpha_test) doDiscard = true;
  } else if (u_blend_mode == 5 || u_blend_mode == 6) {
    finalOpacity = discardAlpha * meshOpacity;
    if (canDiscard && discardAlpha < u_alpha_test) doDiscard = true;
  } else {
    finalOpacity = discardAlpha * meshOpacity;
  }
  if (doDiscard) discard;

  // Unsupported variants render as a visible magenta tint, never silently wrong.
  if (u_unsupported != 0) {
    gl_FragColor = vec4(1.0, 0.2, 1.0, 0.6);
    return;
  }

  vec3 color;
  if (u_apply_lighting == 1) {
    vec3 n = normalize(v_normal_world);
    float wSky = max(n.y, 0.0);
    float wGround = max(-n.y, 0.0);
    float wHorizon = 1.0 - wSky - wGround;
    vec3 ambient = wSky * u_ambient_sky + wHorizon * u_ambient_horizon + wGround * u_ambient_ground;
    float nDotL = max(dot(n, normalize(u_sun_direction)), 0.0);
    vec3 g = matDiffuse * (ambient + u_sun_color * nDotL);
    vec3 l = matDiffuse * matDiffuse * u_local_light;
    color = sqrt(max(g * g + l, vec3(0.0))) + u_unlit_add;
  } else {
    color = matDiffuse;
  }
  color += specular;
  if (u_unfogged == 0) {
    float fogFactor = clamp((length(v_position_view) - u_fog_range.x) / (u_fog_range.y - u_fog_range.x), 0.0, 1.0);
    vec3 fogTarget = (u_blend_mode == 3 || u_blend_mode == 4) ? vec3(0.0)
      : u_blend_mode == 5 ? vec3(1.0)
      : u_blend_mode == 6 ? vec3(0.5)
      : u_blend_mode == 7 ? u_fog_color * finalOpacity : u_fog_color;
    color = mix(color, fogTarget, fogFactor);
  }

  gl_FragColor = vec4(color, finalOpacity);
}
`;
