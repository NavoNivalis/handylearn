import { ExtractGroupId } from "src/data/dictionary/vocab-extract";
import { t } from "src/lang/helpers";

/** 分组 id -> 界面文案 */
export function vocabGroupLabel(group: ExtractGroupId): string {
    switch (group) {
        case "zk":
            return t("EXTRACT_GROUP_ZK");
        case "gk":
            return t("EXTRACT_GROUP_GK");
        case "cet4":
            return t("EXTRACT_GROUP_CET4");
        case "cet6":
            return t("EXTRACT_GROUP_CET6");
        case "ky":
            return t("EXTRACT_GROUP_KY");
        case "toefl":
            return t("EXTRACT_GROUP_TOEFL");
        case "ielts":
            return t("EXTRACT_GROUP_IELTS");
        case "gre":
            return t("EXTRACT_GROUP_GRE");
        case "high":
            return t("EXTRACT_GROUP_HIGH");
        case "mid":
            return t("EXTRACT_GROUP_MID");
        default:
            return t("EXTRACT_GROUP_TECHNICAL");
    }
}
