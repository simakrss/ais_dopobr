import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import server as ocr_server


class VerticalFieldOcrTests(unittest.TestCase):
    @staticmethod
    def _normalized_angle(value):
        return int(value) % 360

    def recognize_with_candidates(self, candidates, *, dimensions=(240, 1200), failing_angles=()):
        path_angles = {}
        seen_angles = []
        rotation_commands = []
        failing_angle_set = {self._normalized_angle(angle) for angle in failing_angles}

        def run_command(arguments, **_kwargs):
            target = Path(arguments[-1])
            angle = 0
            if "-rotate" in arguments:
                rotation_index = arguments.index("-rotate")
                angle = self._normalized_angle(arguments[rotation_index + 1])
                if angle in failing_angle_set:
                    raise RuntimeError(f"rotation {angle} failed")
            else:
                source_angle = path_angles.get(str(Path(arguments[1])), 0)
                angle = source_angle
            path_angles[str(target)] = angle
            target.write_bytes(b"prepared")
            if "-rotate" in arguments:
                rotation_commands.append((angle, target.name, target.exists()))

        def tesseract_text(image_path, page_segmentation_mode, **_kwargs):
            angle = path_angles.get(str(Path(image_path)), 0)
            seen_angles.append(angle)
            candidate = candidates.get(angle, {})
            if page_segmentation_mode == 7:
                return str(candidate.get("text") or "")
            return str(candidate.get("secondary") or "")

        def normalize_value(key, value):
            self.assertEqual(key, "passportNumber")
            source = str(value or "")
            for candidate in candidates.values():
                marker = str(candidate.get("text") or "")
                if marker and marker in source:
                    return (
                        str(candidate.get("value") or ""),
                        float(candidate.get("confidence") or 0),
                    )
            return "", 0.0

        with tempfile.TemporaryDirectory(prefix="ais-vertical-field-test-"):
            with (
                patch.object(
                    ocr_server,
                    "decode_field_region_payload",
                    return_value=("passportNumber", b"\xff\xd8\xff\xd9"),
                ),
                patch.object(ocr_server, "image_dimensions", return_value=dimensions),
                patch.object(ocr_server, "run_command", side_effect=run_command),
                patch.object(ocr_server, "tesseract_text", side_effect=tesseract_text),
                patch.object(
                    ocr_server,
                    "normalize_recognized_field_value",
                    side_effect=normalize_value,
                ),
            ):
                result = ocr_server.recognize_field({"key": "passportNumber"})

        return result, seen_angles, rotation_commands

    def test_invalid_upright_candidate_falls_back_to_vertical_text(self):
        result, seen_angles, rotation_commands = self.recognize_with_candidates({
            0: {
                "text": "UPRIGHT_GARBLED",
                "value": "",
                "confidence": 0.99,
            },
            90: {
                "text": "VERTICAL_90_WINNER",
                "value": "12 34 567890",
                "confidence": 0.94,
            },
            270: {
                "text": "VERTICAL_270_WEAK",
                "value": "98 76 543210",
                "confidence": 0.72,
            },
        })

        self.assertTrue({0, 90, 270}.issubset(set(seen_angles)))
        self.assertTrue({90, 270}.issubset({item[0] for item in rotation_commands}))
        self.assertTrue(all(item[2] for item in rotation_commands))
        self.assertTrue(all(f"-{item[0]}.png" in item[1] for item in rotation_commands))
        self.assertEqual(result["value"], "12 34 567890")
        self.assertEqual(result["confidence"], 0.94)
        self.assertEqual(result["recognitionRotation"], 90)
        self.assertEqual(result["rawText"], "VERTICAL_90_WINNER")
        self.assertEqual(result["evidence"], "VERTICAL_90_WINNER")

    def test_most_confident_normalized_candidate_wins(self):
        result, seen_angles, rotation_commands = self.recognize_with_candidates({
            0: {
                "text": "UPRIGHT_VALID",
                "value": "11 11 111111",
                "confidence": 0.76,
            },
            90: {
                "text": "VERTICAL_90_VALID",
                "value": "22 22 222222",
                "confidence": 0.88,
            },
            270: {
                "text": "VERTICAL_270_WINNER",
                "value": "33 33 333333",
                "confidence": 0.97,
            },
        })

        self.assertTrue({0, 90, 270}.issubset(set(seen_angles)))
        self.assertTrue({90, 270}.issubset({item[0] for item in rotation_commands}))
        self.assertEqual(result["value"], "33 33 333333")
        self.assertEqual(result["confidence"], 0.97)
        self.assertEqual(result["recognitionRotation"], 270)
        self.assertEqual(result["rawText"], "VERTICAL_270_WINNER")
        self.assertEqual(result["evidence"], "VERTICAL_270_WINNER")

    def test_tall_region_checks_vertical_text_even_with_confident_upright_candidate(self):
        result, seen_angles, _rotation_commands = self.recognize_with_candidates({
            0: {
                "text": "UPRIGHT_CONFIDENT",
                "value": "11 11 111111",
                "confidence": 0.99,
            },
            90: {
                "text": "VERTICAL_CONFIDENT",
                "value": "22 22 222222",
                "confidence": 1.0,
            },
        })

        self.assertTrue({90, 270}.issubset(set(seen_angles)))
        self.assertEqual(result["value"], "22 22 222222")
        self.assertEqual(result["recognitionRotation"], 90)

    def test_equal_candidates_prefer_upright_orientation(self):
        result, _seen_angles, _rotation_commands = self.recognize_with_candidates({
            0: {
                "text": "ZERO_ANGLE",
                "value": "11 11 111111",
                "confidence": 0.88,
            },
            90: {
                "text": "NINE_ANGLE",
                "value": "22 22 222222",
                "confidence": 0.88,
            },
        })

        self.assertEqual(result["value"], "11 11 111111")
        self.assertEqual(result["recognitionRotation"], 0)

    def test_confident_horizontal_region_avoids_unnecessary_rotations(self):
        result, seen_angles, rotation_commands = self.recognize_with_candidates(
            {
                0: {
                    "text": "UPRIGHT_HIGH_CONFIDENCE",
                    "value": "11 11 111111",
                    "confidence": 0.99,
                },
            },
            dimensions=(1200, 240),
        )

        self.assertEqual(set(seen_angles), {0})
        self.assertEqual(rotation_commands, [])
        self.assertEqual(result["recognitionRotation"], 0)

    def test_optional_rotation_failure_keeps_upright_candidate(self):
        result, seen_angles, _rotation_commands = self.recognize_with_candidates(
            {
                0: {
                    "text": "UPRIGHT_FALLBACK",
                    "value": "11 11 111111",
                    "confidence": 0.75,
                },
            },
            failing_angles=(90, 270),
        )

        self.assertEqual(set(seen_angles), {0})
        self.assertEqual(result["value"], "11 11 111111")
        self.assertEqual(result["recognitionRotation"], 0)


if __name__ == "__main__":
    unittest.main()
