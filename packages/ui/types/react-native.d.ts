// Minimal type stub so @revhappy/ui typechecks without installing
// react-native (~200 MB). Consumers who target React Native install
// the real react-native package — at that point its bundled types
// supersede these declarations.
//
// Only the surface that packages/ui/src/native actually uses is
// declared here. Extending this stub is a red flag that a native
// component is pulling too much RN internal API — prefer to lift
// the logic into core/ and keep native/ thin.

declare module 'react-native' {
  import type { ComponentType, ReactNode, Ref } from 'react';

  export type StyleProp<T> = T | readonly (T | null | undefined | false)[] | null | undefined;

  export interface ViewStyle {
    [key: string]: unknown;
  }
  export interface TextStyle {
    [key: string]: unknown;
  }
  export interface ImageStyle {
    [key: string]: unknown;
  }

  export interface ViewProps {
    style?: StyleProp<ViewStyle>;
    children?: ReactNode;
    accessibilityLabel?: string;
    accessibilityRole?: string;
    testID?: string;
    [key: string]: unknown;
  }
  export const View: ComponentType<ViewProps>;

  export interface TextProps {
    style?: StyleProp<TextStyle>;
    children?: ReactNode;
    numberOfLines?: number;
    accessibilityLabel?: string;
    accessibilityRole?: string;
    testID?: string;
    [key: string]: unknown;
  }
  export const Text: ComponentType<TextProps>;

  export interface TextInputProps {
    style?: StyleProp<TextStyle>;
    value?: string;
    defaultValue?: string;
    placeholder?: string;
    placeholderTextColor?: string;
    onChangeText?: (text: string) => void;
    autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
    autoCorrect?: boolean;
    editable?: boolean;
    testID?: string;
    [key: string]: unknown;
  }
  export const TextInput: ComponentType<TextInputProps>;

  export interface TouchableOpacityProps extends ViewProps {
    onPress?: () => void;
    disabled?: boolean;
    activeOpacity?: number;
  }
  export const TouchableOpacity: ComponentType<TouchableOpacityProps>;

  export interface PressableProps extends ViewProps {
    onPress?: () => void;
    disabled?: boolean;
  }
  export const Pressable: ComponentType<PressableProps>;

  export interface ActivityIndicatorProps {
    size?: 'small' | 'large' | number;
    color?: string;
    style?: StyleProp<ViewStyle>;
    animating?: boolean;
    testID?: string;
  }
  export const ActivityIndicator: ComponentType<ActivityIndicatorProps>;

  export interface FlatListProps<ItemT> {
    data: readonly ItemT[] | null | undefined;
    renderItem: (info: { item: ItemT; index: number }) => ReactNode;
    keyExtractor?: (item: ItemT, index: number) => string;
    ListEmptyComponent?: ComponentType | ReactNode;
    style?: StyleProp<ViewStyle>;
    contentContainerStyle?: StyleProp<ViewStyle>;
    testID?: string;
    ref?: Ref<unknown>;
    [key: string]: unknown;
  }
  export const FlatList: <ItemT>(props: FlatListProps<ItemT>) => import('react').ReactElement | null;

  export interface StyleSheetStatic {
    create<T extends Record<string, ViewStyle | TextStyle | ImageStyle>>(styles: T): T;
    flatten<T>(style: StyleProp<T>): T;
    hairlineWidth: number;
    absoluteFill: ViewStyle;
    absoluteFillObject: ViewStyle;
  }
  export const StyleSheet: StyleSheetStatic;
}
