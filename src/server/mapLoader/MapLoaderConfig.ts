import type { GehennaMapId } from "../mapConfig";

/**
 * Map loading screen configuration with images and CoD WaW-style flavor text
 */

export interface MapLoadConfig {
  mapId: GehennaMapId;
  displayName: string;
  description: string;
  menuImagePath: string; // For main menu selection screen
  loadingImagePath: string; // For loading screen background
  loadingTips: string[]; // Rotating tips shown during load
}

export const MAP_LOAD_CONFIG: Record<GehennaMapId, MapLoadConfig> = {
  industrial_yard: {
    mapId: "industrial_yard",
    displayName: "Industrial Yard",
    description: "An abandoned industrial complex overrun by the undead.",
    menuImagePath: "assets/ui/map-images/industrial-yard-menu.jpg",
    loadingImagePath: "assets/ui/map-images/industrial-yard-loading.jpg",
    loadingTips: [
      "Stay on the higher ground when the horde swells.",
      "Use the catwalks to escape tight situations.",
      "Mystery Box location: Near the shipping containers.",
      "Pack-a-Punch is hidden in the back warehouse.",
      "Headshots deal 2.2x damage—make your shots count!",
      "Round time decreases by 5 seconds each round.",
      "Buy perks early to survive longer.",
      "Melee kills earn 130 points in early rounds.",
    ],
  },
  test_zone: {
    mapId: "test_zone",
    displayName: "Test Arena",
    description: "A controlled arena for testing and training.",
    menuImagePath: "assets/ui/map-images/test-zone-menu.jpg",
    loadingImagePath: "assets/ui/map-images/test-zone-loading.jpg",
    loadingTips: [
      "This arena has unlimited lethal equipment.",
      "Use the control pillars to customize your experience.",
      "Perfect for learning weapon mechanics.",
      "Test your strategies against the horde.",
    ],
  },
  high_bastion: {
    mapId: "high_bastion",
    displayName: "High Bastion",
    description: "A fortress in the mountains with multiple levels.",
    menuImagePath: "assets/ui/map-images/high-bastion-menu.jpg",
    loadingImagePath: "assets/ui/map-images/high-bastion-loading.jpg",
    loadingTips: [
      "Use elevation to your advantage against zombies.",
      "Multiple paths lead through the fortress—know your escape routes.",
      "Barricades will slow the horde's advance.",
      "Keep moving—don't get trapped on the narrow bridges.",
      "High ground is crucial for survival.",
      "Watch your ammo reserves in tight quarters.",
    ],
  },
  the_sprawl: {
    mapId: "the_sprawl",
    displayName: "The Sprawl",
    description: "A massive urban city sprawling across multiple blocks.",
    menuImagePath: "assets/ui/map-images/sprawl-menu.jpg",
    loadingImagePath: "assets/ui/map-images/sprawl-loading.jpg",
    loadingTips: [
      "The city's alleys provide good sightlines.",
      "Use building interiors for temporary shelter.",
      "The sprawl expands with each round.",
      "Don't get pinned in the narrow streets.",
      "Multiple levels mean multiple escape routes.",
      "High-mounted weapons work well on rooftops.",
      "Plan your rotation between key locations.",
    ],
  },
  draculas_castle: {
    mapId: "draculas_castle",
    displayName: "Dracula's Castle",
    description: "An ancient castle filled with mystery and danger.",
    menuImagePath: "assets/ui/map-images/draculas-castle-menu.jpg",
    loadingImagePath: "assets/ui/map-images/draculas-castle-loading.jpg",
    loadingTips: [
      "Purchase doors to unlock new areas and escape routes.",
      "The castle has multiple levels and secret passages.",
      "Each door costs between 750 and 3000 points.",
      "Save your money early—you'll need it for doors.",
      "The courtyard is a good starting position.",
      "Use torches to light dark corridors.",
      "Ancient magic still flows through these halls.",
      "Beware of the dragon—it guards the keep.",
    ],
  },
  ice_map: {
    mapId: "ice_map",
    displayName: "Frozen Tundra",
    description: "A desolate frozen landscape buried in snow and ice.",
    menuImagePath: "assets/ui/map-images/ice-map-menu.jpg",
    loadingImagePath: "assets/ui/map-images/ice-map-loading.jpg",
    loadingTips: [
      "The ice is slippery—watch your footing.",
      "Visibility is reduced by the constant snowstorm.",
      "Stay warm or risk slowing down in the cold.",
      "Use the rock formations for cover.",
      "The dragon is particularly aggressive in this frozen realm.",
      "Ammo is scarce—make every shot count.",
      "The ice caves offer temporary refuge.",
      "Hypothermia sets in quickly here.",
    ],
  },
};

export function getMapLoadConfig(mapId: GehennaMapId): MapLoadConfig {
  return MAP_LOAD_CONFIG[mapId];
}

export function getRandomLoadingTip(mapId: GehennaMapId): string {
  const config = MAP_LOAD_CONFIG[mapId];
  const tips = config.loadingTips;
  return tips[Math.floor(Math.random() * tips.length)];
}
